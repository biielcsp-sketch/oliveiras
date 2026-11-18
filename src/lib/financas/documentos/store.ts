import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { todaySP } from "@/lib/financas/today";
import { checkUpload, MAX_FILE_BYTES, type FileKind } from "@/lib/saude/files";
import { reconcile, type Extracted } from "./schema";
import { dailyLimitError, docStoragePath, DOC_BUCKET, isDocPath, spDayStartIso } from "./rules";

/**
 * Envio de documento de Finanças, compartilhado entre a tela de Finanças (uploadDocument) e o "+" do Oli.
 * Tudo com a sessão do usuário (RLS); o tipo do arquivo é decidido pelos BYTES, nunca pelo navegador.
 */
type Db = Awaited<ReturnType<typeof createClient>>;

const GENERIC = "Não foi possível salvar. Tente de novo.";

export type UploadedFile = { ok: true; bytes: Uint8Array; kind: FileKind } | { ok: false; error: string };

/** Campo `file` do formulário: PDF ou JPG (pelos bytes), até 4 MB. */
export async function readUploadedFile(form: FormData, key = "file"): Promise<UploadedFile> {
  const file = form.get(key);
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha um PDF ou uma foto (JPG)." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "O arquivo passa de 4 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes);
  if (!check.ok) return { ok: false, error: check.erro };
  return { ok: true, bytes, kind: check.kind };
}

/** Documentos criados hoje pela família (dia de São Paulo); null se a contagem falhou. */
async function countToday(db: Db, householdId: string): Promise<number | null> {
  const { count, error } = await db
    .from("fin_documents")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .gte("created_at", spDayStartIso(todaySP()));
  return error ? null : (count ?? 0);
}

export type StoredFile = { path: string; mime: FileKind["mime"]; size: number };

/**
 * Cria `n` documentos 'pendente' (kind "outro") que apontam para o MESMO arquivo, um insert por vez
 * (created_at crescente = ordem do arquivo no lote). Se algum falhar, os já criados aqui são apagados.
 */
async function insertPendingRows(db: Db, householdId: string, file: StoredFile, n: number): Promise<string[] | null> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { data: doc, error } = await db
      .from("fin_documents")
      .insert({ household_id: householdId, kind: "outro", status: "pendente", file_path: file.path, file_mime: file.mime, file_size: file.size })
      .select("id")
      .single();
    if (error || !doc) {
      if (ids.length) await db.from("fin_documents").delete().eq("household_id", householdId).in("id", ids);
      return null;
    }
    ids.push(doc.id as string);
  }
  return ids;
}

/**
 * Limite diário da família (contando os `n` novos) → arquivo no bucket UMA vez → `n` documentos 'pendente'
 * com o mesmo file_path. Se estourar o limite, nada é enviado nem criado. Se o registro falhar, o arquivo
 * recém-enviado é apagado. Devolve os ids na ordem.
 */
export async function storePendingDocuments(
  db: Db,
  householdId: string,
  file: { bytes: Uint8Array; kind: FileKind },
  n = 1,
): Promise<{ ok: true; ids: string[]; file: StoredFile } | { ok: false; error: string }> {
  const count = await countToday(db, householdId);
  if (count === null) return { ok: false, error: GENERIC };
  const limit = dailyLimitError(count, undefined, n);
  if (limit) return { ok: false, error: limit };

  const stored: StoredFile = { path: docStoragePath(householdId, randomUUID(), file.kind.ext), mime: file.kind.mime, size: file.bytes.length };
  const up = await db.storage.from(DOC_BUCKET).upload(stored.path, file.bytes, { contentType: file.kind.mime, upsert: false });
  if (up.error) return { ok: false, error: "Não foi possível enviar o arquivo. Tente de novo." };

  const ids = await insertPendingRows(db, householdId, stored, Math.max(1, n));
  if (!ids) {
    await db.storage.from(DOC_BUCKET).remove([stored.path]);
    return { ok: false, error: GENERIC };
  }
  return { ok: true, ids, file: stored };
}

/** Um documento: o envio de sempre (Finanças cria antes de chamar a IA, para a falha da IA não perder o arquivo). */
export async function storePendingDocument(
  db: Db,
  householdId: string,
  file: { bytes: Uint8Array; kind: FileKind },
): Promise<{ ok: true; id: string; file: StoredFile } | { ok: false; error: string }> {
  const r = await storePendingDocuments(db, householdId, file, 1);
  return r.ok ? { ok: true, id: r.ids[0], file: r.file } : r;
}

/**
 * A IA achou mais documentos no arquivo já guardado: cria mais `n` pendentes com o mesmo arquivo.
 * O limite do dia conta os `n` (o primeiro já está na contagem). Se estourar ou falhar, nenhum é criado.
 */
export async function addPendingForFile(
  db: Db,
  householdId: string,
  file: StoredFile,
  n: number,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const count = await countToday(db, householdId);
  if (count === null) return { ok: false, error: GENERIC };
  // O primeiro documento do arquivo já está na contagem: a mensagem fala do total do arquivo (n + 1).
  const limit = dailyLimitError(Math.max(0, count - 1), undefined, n + 1);
  if (limit) return { ok: false, error: limit };
  const ids = await insertPendingRows(db, householdId, file, n);
  return ids ? { ok: true, ids } : { ok: false, error: GENERIC };
}

/**
 * Outro documento da família (não descartado) ainda usa este arquivo? Vários documentos lidos do mesmo PDF
 * dividem o file_path. Descartado não conta (o descarte já tirou o arquivo dele). null = não deu para conferir.
 */
export async function docFileInUse(db: Db, householdId: string, docId: string, path: string): Promise<boolean | null> {
  const { count, error } = await db
    .from("fin_documents")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("file_path", path)
    .neq("id", docId)
    .neq("status", "descartado");
  if (error) return null;
  return (count ?? 0) > 0;
}

/**
 * Tira o arquivo do bucket só se nenhum outro documento da família ainda usa o mesmo caminho.
 * Na dúvida (conferência falhou), o arquivo fica: perder o PDF dos outros boletos é pior que guardar a mais.
 */
export async function removeDocFileIfUnused(db: Db, householdId: string, docId: string, path: string): Promise<boolean> {
  if (!isDocPath(path)) return false;
  const inUse = await docFileInUse(db, householdId, docId, path);
  if (inUse !== false) return false;
  const { error } = await db.storage.from(DOC_BUCKET).remove([path]);
  return !error;
}

/**
 * Grava as sugestões lidas pela IA no documento pendente (para a conferência).
 * Nada vira lançamento ou conta sem o usuário confirmar na tela de conferência.
 */
export async function applyExtraction(db: Db, householdId: string, id: string, data: Extracted) {
  const rec = reconcile(data, todaySP());
  await db
    .from("fin_documents")
    .update({
      extracted: data,
      kind: rec.tipo,
      payee: rec.beneficiario,
      amount: rec.valor,
      due_date: rec.vencimento,
      paid_on: rec.data_pagamento,
      // A coluna barcode só é gravada na confirmação (índice único de boletos não descartados);
      // até lá o código fica em `extracted` e a conferência mostra o aviso de duplicidade.
    })
    .eq("household_id", householdId)
    .eq("id", id);
}

/** Telas que mostram documentos, contas e boletos. */
export function revalidateDocPaths() {
  revalidatePath("/financas", "layout");
  revalidatePath("/inicio");
  // Quando o envio vem de Casa > Contas, a conta e o boleto aparecem lá.
  revalidatePath("/casa", "layout");
}
