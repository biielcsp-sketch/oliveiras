import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { todaySP } from "@/lib/financas/today";
import { checkUpload, MAX_FILE_BYTES, type FileKind } from "@/lib/saude/files";
import { reconcile, type Extracted } from "./schema";
import { dailyLimitError, docStoragePath, DOC_BUCKET, spDayStartIso } from "./rules";

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

/**
 * Limite diário da família → arquivo no bucket → documento 'pendente' (kind "outro").
 * Se o registro falhar, o arquivo recém-enviado é apagado. Devolve o id do documento.
 */
export async function storePendingDocument(
  db: Db,
  householdId: string,
  file: { bytes: Uint8Array; kind: FileKind },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { count, error: countError } = await db
    .from("fin_documents")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .gte("created_at", spDayStartIso(todaySP()));
  if (countError) return { ok: false, error: GENERIC };
  const limit = dailyLimitError(count ?? 0);
  if (limit) return { ok: false, error: limit };

  const path = docStoragePath(householdId, randomUUID(), file.kind.ext);
  const up = await db.storage.from(DOC_BUCKET).upload(path, file.bytes, { contentType: file.kind.mime, upsert: false });
  if (up.error) return { ok: false, error: "Não foi possível enviar o arquivo. Tente de novo." };

  const { data: doc, error } = await db
    .from("fin_documents")
    .insert({ household_id: householdId, kind: "outro", status: "pendente", file_path: path, file_mime: file.kind.mime, file_size: file.bytes.length })
    .select("id")
    .single();
  if (error || !doc) {
    await db.storage.from(DOC_BUCKET).remove([path]);
    return { ok: false, error: GENERIC };
  }
  return { ok: true, id: doc.id as string };
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
