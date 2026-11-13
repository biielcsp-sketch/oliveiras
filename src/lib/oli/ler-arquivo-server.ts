import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { getAppContext } from "@/lib/data";
import { docsApiKey, geminiGenerate } from "@/lib/financas/documentos/extract";
import { runStructured, type Generate } from "@/lib/financas/documentos/extraction";
import { DOC_BUCKET, isDocPath } from "@/lib/financas/documentos/rules";
import { detectFileKind, isFileMime, isStoragePath } from "@/lib/saude/files";
import { CASA_BUCKET, isCasaDocPath, isCasaPetPath } from "@/lib/casa/docs";
import { carismaEnabled, myAccountById, runWithDrive, RevokedError } from "@/lib/igreja/carisma";
import { DOCX_MIME, headMatches, isDriveId, type CarismaMime } from "@/lib/igreja/files";
import { docxToText } from "@/lib/igreja/summarize";
import { downloadFile } from "@/lib/google/drive";
import { checkDailyLimit } from "./file-limit";
import { OLI_CONTENT_INSTRUCTION, OLI_CONTENT_SCHEMA } from "./conteudo-schema";
import {
  ARQUIVO_NAO_ENCONTRADO,
  buildLerArquivo,
  carismaReadDecision,
  OLI_READ_MAX_BYTES,
  OLI_READ_MAX_DOCX_CHARS,
  parseOliContent,
  SEM_ARQUIVO,
  type ContentMime,
  type LerArquivoData,
  type OliContentReading,
} from "./ler-arquivo";
import type { ArquivoRef } from "./tool-args";

/**
 * ler_arquivo no servidor. Tudo com a SESSÃO do usuário (RLS), nunca chave de serviço:
 * - Supabase Storage (saude, casa, financas): o registro é lido pelo RLS (só da família) e o download usa o
 *   RLS do bucket, como as rotas /arquivo das telas; o caminho é conferido no formato gerado pelo servidor.
 * - Google Drive (Carisma): igual ao resumo da aula: só arquivos prontos e só com a conta Google da própria
 *   pessoa; arquivo da aula compartilhada pelo cônjuge (Drive dele) é recusado.
 * Ordem: recusas baratas (não achou, sem arquivo, Drive de outra pessoa, grande demais) → limite diário
 * (o MESMO do "+") → download → tipo conferido pelos BYTES → IA.
 */
type Db = Awaited<ReturnType<typeof createClient>>;
type Ctx = Awaited<ReturnType<typeof getAppContext>>;

export type LerArquivoResult = { ok: true; data: LerArquivoData } | { ok: false; erro: string };

type Source =
  | { kind: "storage"; bucket: string; path: string; mime: "application/pdf" | "image/jpeg"; nome: unknown; pessoa: unknown }
  | { kind: "drive"; accountId: string; driveId: string; mime: CarismaMime; size: number; status: string; nome: unknown };

const STORAGE: Record<
  Exclude<ArquivoRef["tipo"], "carisma">,
  { table: string; cols: string; bucket: string; valid: (p: unknown) => boolean; nome: string; who: "member" | "pet" | null }
> = {
  exame: { table: "health_exams", cols: "id, member_id, name, file_path, file_mime", bucket: "saude", valid: isStoragePath, nome: "name", who: "member" },
  carteirinha: { table: "health_insurance_cards", cols: "id, member_id, operator, file_path, file_mime", bucket: "saude", valid: isStoragePath, nome: "operator", who: "member" },
  procedimento: { table: "health_procedures", cols: "id, member_id, name, file_path, file_mime", bucket: "saude", valid: isStoragePath, nome: "name", who: "member" },
  vacina: { table: "health_vaccines", cols: "id, member_id, name, file_path, file_mime", bucket: "saude", valid: isStoragePath, nome: "name", who: "member" },
  casa_documento: { table: "casa_documents", cols: "id, title, file_path, file_mime", bucket: CASA_BUCKET, valid: isCasaDocPath, nome: "title", who: null },
  pet_saude: { table: "casa_pet_health", cols: "id, pet_id, name, file_path, file_mime", bucket: CASA_BUCKET, valid: isCasaPetPath, nome: "name", who: "pet" },
  pet_veterinario: { table: "casa_pet_vet", cols: "id, pet_id, reason, file_path, file_mime", bucket: CASA_BUCKET, valid: isCasaPetPath, nome: "reason", who: "pet" },
  financas: { table: "fin_documents", cols: "id, payee, status, file_path, file_mime", bucket: DOC_BUCKET, valid: isDocPath, nome: "payee", who: null },
};

/** Acha o registro (RLS) e decide se dá para ler, sem baixar nada e sem gastar leitura. */
async function resolveSource(db: Db, ctx: Ctx, ref: ArquivoRef): Promise<{ ok: true; source: Source } | { ok: false; erro: string }> {
  if (ref.tipo === "carisma") {
    if (!carismaEnabled(ctx.household.id)) return { ok: false, erro: "O Carisma não está liberado para esta família." };
    // RLS de igreja_carisma_files: só arquivos de aula própria ou compartilhada (igual à tela).
    const { data: f } = await db
      .from("igreja_carisma_files")
      .select("id, google_account_id, drive_file_id, file_mime, file_size, display_name, status")
      .eq("household_id", ctx.household.id)
      .eq("id", ref.id)
      .maybeSingle();
    if (!f || !isDriveId(f.drive_file_id)) return { ok: false, erro: ARQUIVO_NAO_ENCONTRADO };
    // Só a conta Google da própria pessoa (nunca a do cônjuge), como no resumo da aula.
    const account = await myAccountById(db, ctx, f.google_account_id as string);
    const refuse = carismaReadDecision({ status: f.status as string, file_size: Number(f.file_size) }, account);
    if (refuse) return { ok: false, erro: refuse };
    return {
      ok: true,
      source: { kind: "drive", accountId: account!.id, driveId: f.drive_file_id as string, mime: f.file_mime as CarismaMime, size: Number(f.file_size), status: f.status as string, nome: f.display_name },
    };
  }
  const spec = STORAGE[ref.tipo];
  let q = db.from(spec.table).select(spec.cols).eq("household_id", ctx.household.id).eq("id", ref.id);
  if (ref.tipo === "financas") q = q.neq("status", "descartado");
  const { data } = await q.maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) return { ok: false, erro: ARQUIVO_NAO_ENCONTRADO };
  if (!row.file_path) return { ok: false, erro: SEM_ARQUIVO };
  if (!spec.valid(row.file_path) || !isFileMime(row.file_mime)) return { ok: false, erro: ARQUIVO_NAO_ENCONTRADO };
  let pessoa: unknown = null;
  if (spec.who === "member") pessoa = ctx.members.find((m) => m.id === row.member_id)?.name ?? null;
  if (spec.who === "pet" && typeof row.pet_id === "string") {
    const { data: pet } = await db.from("casa_pets").select("name").eq("household_id", ctx.household.id).eq("id", row.pet_id).maybeSingle();
    pessoa = pet?.name ?? null;
  }
  return { ok: true, source: { kind: "storage", bucket: spec.bucket, path: row.file_path as string, mime: row.file_mime, nome: row[spec.nome], pessoa } };
}

/** Baixa e confere os bytes. Devolve o que a IA recebe (docx vira texto). */
async function download(db: Db, ctx: Ctx, s: Source): Promise<{ ok: true; bytes: Uint8Array; mime: ContentMime } | { ok: false; erro: string }> {
  const fail = { ok: false as const, erro: "Não consegui abrir o arquivo agora. Tente de novo." };
  if (s.kind === "storage") {
    const { data: blob, error } = await db.storage.from(s.bucket).download(s.path);
    if (error || !blob) return fail;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length === 0 || bytes.length > OLI_READ_MAX_BYTES || detectFileKind(bytes)?.mime !== s.mime) return fail;
    return { ok: true, bytes, mime: s.mime };
  }
  const acc = await myAccountById(db, ctx, s.accountId);
  if (!acc) return fail;
  let bytes: Uint8Array;
  try {
    bytes = await runWithDrive(db, acc, (t) => downloadFile(t, s.driveId, OLI_READ_MAX_BYTES));
  } catch (e) {
    return e instanceof RevokedError ? { ok: false, erro: "O acesso ao Google Drive foi desconectado. Reconecte na tela do Carisma." } : fail;
  }
  if (!headMatches(s.mime, bytes.subarray(0, 16))) return fail;
  if (s.mime === DOCX_MIME) {
    const text = await docxToText(bytes);
    if (!text?.trim()) return fail;
    return { ok: true, bytes: new TextEncoder().encode(text.slice(0, OLI_READ_MAX_DOCX_CHARS)), mime: "text/plain" };
  }
  return { ok: true, bytes, mime: s.mime as ContentMime };
}

/** Chamada à IA (mesmo cliente, tempo limite e chave da leitura de documentos). `generate` injetável nos testes. */
export async function summarizeContent(bytes: Uint8Array, mime: ContentMime, generate?: Generate) {
  let gen = generate;
  if (!gen) {
    const apiKey = docsApiKey();
    if (!apiKey) return { ok: false as const, motivo: "erro" as const };
    gen = geminiGenerate(apiKey);
  }
  const r = await runStructured<OliContentReading>(gen, bytes, mime, {
    systemInstruction: OLI_CONTENT_INSTRUCTION,
    schema: OLI_CONTENT_SCHEMA,
    parse: parseOliContent,
  });
  // Só o motivo; nunca o conteúdo do arquivo nem a resposta da IA.
  if (!r.ok) console.error("Oli: ler_arquivo falhou:", r.motivo);
  return r;
}

export async function lerArquivo(ctx: Ctx, ref: ArquivoRef): Promise<LerArquivoResult> {
  const db = await createClient();
  const src = await resolveSource(db, ctx, ref);
  if (!src.ok) return src;

  // Limite diário ANTES de baixar e de chamar a IA (o mesmo do "+": registra e conta, fail closed).
  const limit = await checkDailyLimit(db, ctx.household.id);
  if (limit) return { ok: false, erro: limit };

  const file = await download(db, ctx, src.source);
  if (!file.ok) return file;

  const r = await summarizeContent(file.bytes, file.mime);
  if (!r.ok) {
    return { ok: false, erro: r.motivo === "timeout" ? "A leitura demorou demais. Tente de novo." : "Não consegui ler o arquivo agora. Tente de novo." };
  }
  const nome = src.source.nome;
  const pessoa = src.source.kind === "storage" ? src.source.pessoa : null;
  return { ok: true, data: buildLerArquivo({ id: `${ref.tipo}:${ref.id}`, tipo: ref.tipo, nome, pessoa }, r.data) };
}
