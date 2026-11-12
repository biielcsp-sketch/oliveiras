"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { carismaAllowedFor } from "@/lib/family-access";
import { todaySP } from "@/lib/financas/today";
import { spDayStartIso } from "@/lib/financas/documentos/rules";
import { formToObject } from "@/lib/casa/input";
import { REVOKED_MESSAGE } from "@/lib/google/agenda";
import {
  downloadFile,
  downloadRange,
  driveErrorMessage,
  generateFileId,
  getFile,
  startResumableUpload,
  trashFile,
} from "@/lib/google/drive";
import { isUuid, validateLessonInput, validateSummaryEdit } from "@/lib/igreja/input";
import {
  CARISMA_MAX_BYTES,
  DOCX_MIME,
  HEAD_BYTES,
  headMatches,
  isDocxZip,
  safeWebViewLink,
  validateDeclaredUpload,
  type CarismaMime,
} from "@/lib/igreja/files";
import { selectSummaryFiles, SUMMARY_ERROR_MESSAGE, summaryLimitError, type SourceFile } from "@/lib/igreja/summary";
import { docxToText, summarizeLesson, summaryConfigured } from "@/lib/igreja/summarize";
import {
  carismaEnabled,
  ensureLessonFolder,
  familyReaders,
  FILE_COLS,
  myAccountById,
  myDrive,
  ownFile,
  ownLesson,
  RevokedError,
  runWithDrive,
  syncFolderSharing,
  trashAndForget,
  type FileRow,
} from "@/lib/igreja/carisma";

/**
 * Carisma: aulas (dados pessoais; owner_id = usuário da sessão), arquivos no Google Drive do dono
 * (upload DIRETO navegador → Drive; o arquivo nunca passa pela função da Vercel) e resumo por IA.
 */
export type LessonState = { ok?: boolean; error?: string; message?: string; id?: string } | null;
type Result = { ok: boolean; erro?: string; aviso?: string };

const GENERIC = "Não foi possível salvar. Tente de novo.";
const NO_LESSON = "Aula não encontrada (ou não é sua).";
const MAX_FILES_PER_LESSON = 30;
const done = () => revalidatePath("/ministerio", "layout");

function driveFail(e: unknown) {
  return e instanceof RevokedError ? REVOKED_MESSAGE : driveErrorMessage(e);
}

const ACCESS_MESSAGE = {
  "sem-conta": "Conecte sua conta Google para guardar arquivos no seu Google Drive.",
  revogado: REVOKED_MESSAGE,
  "sem-drive": "Conecte o Google Drive para enviar arquivos.",
} as const;

/* ---------- Aulas ---------- */

export async function saveLesson(_: LessonState, form: FormData): Promise<LessonState> {
  const ctx = await getAppContext();
  const parsed = validateLessonInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  const db = await createClient();
  if (id) {
    if (!isUuid(id)) return { error: NO_LESSON };
    const { data, error } = await db
      .from("igreja_carisma_lessons")
      .update(parsed.value)
      .eq("household_id", ctx.household.id)
      .eq("owner_id", ctx.user.id)
      .eq("id", id)
      .select("id");
    if (error) return { error: GENERIC };
    if (!data?.length) return { error: NO_LESSON };
    done();
    return { ok: true, message: "Aula atualizada.", id };
  }
  const { data, error } = await db
    .from("igreja_carisma_lessons")
    .insert({ ...parsed.value, household_id: ctx.household.id, owner_id: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) return { error: GENERIC };
  done();
  return { ok: true, message: "Aula salva.", id: data.id as string };
}

/** Arquivos e pasta vão para a lixeira do Drive (não apaga de vez); depois a aula sai (arquivos em cascata). */
export async function deleteLesson(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: NO_LESSON };
  const db = await createClient();
  const lesson = await ownLesson(db, ctx, id);
  if (!lesson) return { ok: false, erro: NO_LESSON };
  const { data: files } = await db.from("igreja_carisma_files").select(FILE_COLS).eq("household_id", ctx.household.id).eq("lesson_id", id).eq("owner_id", ctx.user.id);
  try {
    for (const f of (files ?? []) as FileRow[]) await trashAndForget(db, ctx, f);
  } catch (e) {
    done();
    return { ok: false, erro: `${driveFail(e)} A aula não foi apagada.` };
  }
  let aviso: string | undefined;
  if (lesson.drive_folder_id) {
    const { access, account } = await myDrive(db, ctx);
    if (access === "ok" && account) {
      try {
        await runWithDrive(db, account, (t) => trashFile(t, lesson.drive_folder_id!));
      } catch (e) {
        return { ok: false, erro: `${driveFail(e)} A aula não foi apagada.` };
      }
    } else {
      aviso = "A pasta da aula ficou no seu Google Drive (o Drive não está conectado).";
    }
  }
  const { error } = await db.from("igreja_carisma_lessons").delete().eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", id);
  if (error) return { ok: false, erro: "Não foi possível apagar a aula." };
  done();
  return { ok: true, aviso };
}

/**
 * Compartilhar com a família: primeiro o Drive (leitura da PASTA da aula para o e-mail Google do cônjuge,
 * sem e-mail de notificação; ou remove), depois o banco. Falha do Drive não muda nada (dá para tentar de novo).
 * Chamar de novo com o mesmo valor reaplica as permissões (ex.: o cônjuge conectou o Google depois).
 */
export async function setLessonShared(id: string, shared: boolean): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id) || typeof shared !== "boolean") return { ok: false, erro: NO_LESSON };
  const db = await createClient();
  const lesson = await ownLesson(db, ctx, id);
  if (!lesson) return { ok: false, erro: NO_LESSON };
  const readers = await familyReaders(db, ctx);
  // Descompartilhar mexe no Drive sempre que a pasta existe (tira qualquer leitor, mesmo de conta antiga do cônjuge);
  // compartilhar só quando há e-mail Google da família para receber a leitura.
  const touchDrive = Boolean(lesson.drive_folder_id) && (!shared || readers.emails.length > 0);
  let account = null;
  if (touchDrive) {
    const drive = await myDrive(db, ctx);
    if (drive.access !== "ok" || !drive.account) return { ok: false, erro: drive.access === "revogado" ? REVOKED_MESSAGE : "Conecte o Google Drive para mudar o acesso aos arquivos." };
    account = drive.account;
    try {
      await runWithDrive(db, account, (t) => syncFolderSharing(t, lesson.drive_folder_id!, readers.emails, shared));
    } catch (e) {
      return { ok: false, erro: `${driveFail(e)} O compartilhamento não mudou.` };
    }
  }
  const { error } = await db.from("igreja_carisma_lessons").update({ shared }).eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", id);
  if (error) {
    // Desfaz no Drive para não ficar diferente do app.
    if (touchDrive && account) await runWithDrive(db, account, (t) => syncFolderSharing(t, lesson.drive_folder_id!, readers.emails, lesson.shared)).catch(() => undefined);
    return { ok: false, erro: GENERIC };
  }
  done();
  const aviso =
    shared && readers.withoutGoogle.length
      ? `${readers.withoutGoogle.join(", ")} ainda não conectou o Google: os arquivos só abrem depois que conectar (e você tocar em "Atualizar acesso aos arquivos").`
      : undefined;
  return { ok: true, aviso };
}

/* ---------- Upload direto ao Drive ---------- */

export type PrepareResult = { ok: true; fileId: string; uploadUrl: string } | { ok: false; erro: string };

/** Origem do app para o Google responder com CORS ao PUT do navegador. Só http(s), sem caminho. */
async function appOrigin() {
  const h = await headers();
  const raw = h.get("origin") ?? "";
  try {
    const u = new URL(raw);
    // Mesmo critério do Next para server actions: Origin precisa bater com o host do pedido.
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (/^https?:$/.test(u.protocol) && u.host === host) return u.origin;
  } catch {}
  return null;
}

/**
 * (1) Valida aula, tipo e tamanho declarados (≤ 20 MB); (2) garante a pasta da aula no Drive do dono;
 * (3) gera o ID do arquivo, grava a linha 'pendente' e (4) cria a sessão de upload resumível.
 * O navegador recebe só o session URI daquele arquivo.
 */
export async function prepareDriveUpload(input: { lessonId: string; name: string; mime: string; size: number }): Promise<PrepareResult> {
  const ctx = await getAppContext();
  if (!carismaEnabled(ctx.household.id)) return { ok: false, erro: "Envio de arquivos ainda não liberado para esta família." };
  if (!isUuid(input?.lessonId)) return { ok: false, erro: NO_LESSON };
  const parsed = validateDeclaredUpload(input);
  if (!parsed.ok) return parsed;
  const db = await createClient();
  const lesson = await ownLesson(db, ctx, input.lessonId);
  if (!lesson) return { ok: false, erro: NO_LESSON };
  const { count } = await db.from("igreja_carisma_files").select("id", { count: "exact", head: true }).eq("household_id", ctx.household.id).eq("lesson_id", lesson.id);
  if ((count ?? 0) >= MAX_FILES_PER_LESSON) return { ok: false, erro: `No máximo ${MAX_FILES_PER_LESSON} arquivos por aula.` };
  const { access, account } = await myDrive(db, ctx);
  if (access !== "ok" || !account) return { ok: false, erro: ACCESS_MESSAGE[access as keyof typeof ACCESS_MESSAGE] ?? ACCESS_MESSAGE["sem-drive"] };
  const origin = await appOrigin();
  if (!origin) return { ok: false, erro: "Pedido inválido." };

  const rowId = randomUUID();
  let inserted = false;
  try {
    const uploadUrl = await runWithDrive(db, account, async (token) => {
      const folderId = await ensureLessonFolder(db, ctx, account, token, lesson);
      if (lesson.shared) {
        const readers = await familyReaders(db, ctx);
        await syncFolderSharing(token, folderId, readers.emails, true);
      }
      const driveId = await generateFileId(token);
      if (!inserted) {
        const { error } = await db.from("igreja_carisma_files").insert({
          id: rowId,
          household_id: ctx.household.id,
          owner_id: ctx.user.id,
          lesson_id: lesson.id,
          google_account_id: account.id,
          drive_file_id: driveId,
          file_mime: parsed.value.mime,
          file_size: parsed.value.size,
          display_name: parsed.value.displayName,
          status: "pendente",
        });
        if (error) throw new Error("insert");
        inserted = true;
      } else {
        await db.from("igreja_carisma_files").update({ drive_file_id: driveId }).eq("id", rowId).eq("owner_id", ctx.user.id);
      }
      return startResumableUpload(token, {
        id: driveId,
        name: parsed.value.displayName,
        mimeType: parsed.value.mime,
        size: parsed.value.size,
        parentId: folderId,
        appProperties: { oliFile: rowId },
        origin,
      });
    });
    return { ok: true, fileId: rowId, uploadUrl };
  } catch (e) {
    if (inserted) await db.from("igreja_carisma_files").delete().eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", rowId);
    if (e instanceof Error && e.message === "insert") return { ok: false, erro: GENERIC };
    return { ok: false, erro: driveFail(e) };
  }
}

const INVALID_FILE = "O arquivo enviado não é um PDF, Word (.docx) ou imagem JPG/PNG válido e foi descartado.";

/**
 * Depois do PUT do navegador: confere no Drive (metadados) que o arquivo é o preparado (appProperties + pasta da aula),
 * o tamanho REAL (≤ 20 MB) e os bytes (PDF/JPG/PNG pelos primeiros bytes; docx pelo zip com word/document.xml).
 * Inválido → lixeira do Drive + linha apagada. Válido → 'pronto' com o link do Drive.
 */
export async function confirmDriveUpload(fileId: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(fileId)) return { ok: false, erro: "Arquivo inválido." };
  const db = await createClient();
  const file = await ownFile(db, ctx, fileId);
  if (!file) return { ok: false, erro: "Arquivo não encontrado." };
  if (file.status === "pronto") return { ok: true };
  const lesson = await ownLesson(db, ctx, file.lesson_id);
  const acc = await myAccountById(db, ctx, file.google_account_id);
  if (!lesson || !acc) return { ok: false, erro: "Arquivo não encontrado." };
  const forget = () => db.from("igreja_carisma_files").delete().eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", file.id);

  try {
    const verdict = await runWithDrive(db, acc, async (token) => {
      const meta = await getFile(token, file.drive_file_id);
      if (!meta || meta.trashed) return "ausente" as const;
      const size = Number(meta.size);
      const sameUpload = meta.appProperties?.oliFile === file.id && Boolean(lesson.drive_folder_id) && (meta.parents ?? []).includes(lesson.drive_folder_id!);
      let valid = sameUpload && Number.isInteger(size) && size > 0 && size <= CARISMA_MAX_BYTES;
      if (valid) {
        const mime = file.file_mime as CarismaMime;
        if (mime === DOCX_MIME) {
          const bytes = await downloadFile(token, file.drive_file_id, CARISMA_MAX_BYTES);
          valid = isDocxZip(bytes) && (await docxToText(bytes)) !== null;
        } else {
          valid = headMatches(mime, await downloadRange(token, file.drive_file_id, 0, HEAD_BYTES - 1));
        }
      }
      if (!valid) {
        await trashFile(token, file.drive_file_id);
        return "invalido" as const;
      }
      return { size, link: safeWebViewLink(meta.webViewLink) };
    });
    if (verdict === "ausente") {
      await forget();
      done();
      return { ok: false, erro: "O envio não chegou ao Google Drive. Tente de novo." };
    }
    if (verdict === "invalido") {
      await forget();
      done();
      return { ok: false, erro: INVALID_FILE };
    }
    const { error } = await db
      .from("igreja_carisma_files")
      .update({ status: "pronto", file_size: verdict.size, web_view_link: verdict.link })
      .eq("household_id", ctx.household.id)
      .eq("owner_id", ctx.user.id)
      .eq("id", file.id)
      .eq("status", "pendente");
    if (error) return { ok: false, erro: GENERIC };
    done();
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: driveFail(e) };
  }
}

/** Envio que falhou no navegador: o que chegou vai para a lixeira e a linha pendente sai. */
export async function cancelDriveUpload(fileId: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(fileId)) return { ok: false, erro: "Arquivo inválido." };
  const db = await createClient();
  const file = await ownFile(db, ctx, fileId);
  if (!file || file.status !== "pendente") return { ok: true };
  try {
    await trashAndForget(db, ctx, file);
  } catch {
    // Fica pendente e é limpo ao abrir a aula depois de 1 h.
  }
  done();
  return { ok: true };
}

export async function deleteLessonFile(fileId: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(fileId)) return { ok: false, erro: "Arquivo inválido." };
  const db = await createClient();
  const file = await ownFile(db, ctx, fileId);
  if (!file) return { ok: false, erro: "Arquivo não encontrado." };
  try {
    await trashAndForget(db, ctx, file);
  } catch (e) {
    return { ok: false, erro: driveFail(e) };
  }
  done();
  return { ok: true };
}

/* ---------- Resumo ---------- */

export async function summarizeLessonAction(lessonId: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!carismaAllowedFor(ctx.household.id) || !summaryConfigured()) return { ok: false, erro: "Resumo por IA ainda não liberado para esta família." };
  if (!isUuid(lessonId)) return { ok: false, erro: NO_LESSON };
  const db = await createClient();
  const lesson = await ownLesson(db, ctx, lessonId);
  if (!lesson) return { ok: false, erro: NO_LESSON };

  // Limite diário por família ANTES de baixar arquivos e de chamar a IA: registra a tentativa no log imutável
  // (só household_id e lesson_id; created_at/created_by vêm do banco) e conta as do dia já com esta (padrão do Oli).
  const { error: logError } = await db.from("igreja_summary_log").insert({ household_id: ctx.household.id, lesson_id: lesson.id });
  let countToday: number | null = null;
  if (!logError) {
    const { count, error } = await db
      .from("igreja_summary_log")
      .select("id", { count: "exact", head: true })
      .eq("household_id", ctx.household.id)
      .gte("created_at", spDayStartIso(todaySP()));
    countToday = error ? null : count;
  }
  const limit = summaryLimitError({ registered: !logError, countToday });
  if (limit) return { ok: false, erro: limit };

  const now = new Date().toISOString();
  const mark = (fields: Record<string, unknown>) =>
    db.from("igreja_carisma_lessons").update(fields).eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", lesson.id);

  const { data: rows } = await db
    .from("igreja_carisma_files")
    .select(FILE_COLS)
    .eq("household_id", ctx.household.id)
    .eq("lesson_id", lesson.id)
    .eq("status", "pronto")
    .order("created_at");
  // Seleção ANTES de baixar (quantidade e soma de file_size): nunca carrega centenas de MB na memória.
  const { picked, skipped: notPicked } = selectSummaryFiles((rows ?? []) as FileRow[]);
  const files: SourceFile[] = [];
  try {
    for (const f of picked) {
      const acc = await myAccountById(db, ctx, f.google_account_id);
      if (!acc) continue;
      const bytes = await runWithDrive(db, acc, (t) => downloadFile(t, f.drive_file_id, CARISMA_MAX_BYTES));
      files.push({ name: f.display_name, mime: f.file_mime as CarismaMime, bytes });
    }
  } catch (e) {
    await mark({ summary_status: "erro", summarized_at: now });
    done();
    return { ok: false, erro: `Não consegui baixar os arquivos do Google Drive. ${driveFail(e)}` };
  }

  const r = await summarizeLesson(lesson, files);
  if (!r.ok) {
    await mark({ summary_status: "erro", summarized_at: now });
    done();
    return { ok: false, erro: r.motivo === "sem_material" ? "Adicione anotações ou arquivos à aula antes de resumir." : SUMMARY_ERROR_MESSAGE };
  }
  const { error } = await mark({ summary: r.summary, summary_status: "pronto", summarized_at: now });
  if (error) return { ok: false, erro: GENERIC };
  done();
  const out = r.skipped + notPicked;
  return { ok: true, aviso: out ? `${out} arquivo(s) ficaram de fora do resumo (limite de quantidade ou tamanho).` : undefined };
}

/** Resumo editado à mão (texto simples). Vazio limpa e volta para "sem resumo". */
export async function saveSummary(lessonId: string, text: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(lessonId)) return { ok: false, erro: NO_LESSON };
  const parsed = validateSummaryEdit(text);
  if (!parsed.ok) return parsed;
  const db = await createClient();
  const { data, error } = await db
    .from("igreja_carisma_lessons")
    .update({ summary: parsed.value, summary_status: parsed.value ? "pronto" : "nenhum" })
    .eq("household_id", ctx.household.id)
    .eq("owner_id", ctx.user.id)
    .eq("id", lessonId)
    .select("id");
  if (error) return { ok: false, erro: GENERIC };
  if (!data?.length) return { ok: false, erro: NO_LESSON };
  done();
  return { ok: true };
}
