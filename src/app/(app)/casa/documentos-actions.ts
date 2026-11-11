"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { checkUpload, MAX_FILE_BYTES } from "@/lib/saude/files";
import { formToObject, isUuid, validateDocumentInput } from "@/lib/casa/input";
import { CASA_BUCKET, casaDocPath, isCasaDocPath } from "@/lib/casa/docs";

/**
 * Documentos e garantias da Casa. Mesmo padrão de upload da Saúde/Finanças: tipo decidido pelos BYTES (PDF/JPG),
 * até 5 MB, nome uuid gerado aqui, envio com a sessão do usuário (RLS do bucket privado `casa`).
 * A IA NÃO lê estes documentos.
 */
export type DocState = { ok?: boolean; error?: string; message?: string } | null;
type Result = { ok: boolean; erro?: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const GENERIC = "Não foi possível salvar. Tente de novo.";
const NOT_FOUND = "Documento não encontrado.";

function refresh() {
  revalidatePath("/casa", "layout");
}

async function uploadFile(db: Db, householdId: string, form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: true as const, uploaded: null };
  if (file.size > MAX_FILE_BYTES) return { ok: false as const, erro: "O arquivo passa de 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes);
  if (!check.ok) return { ok: false as const, erro: check.erro };
  const path = casaDocPath(householdId, randomUUID(), check.kind.ext);
  const { error } = await db.storage.from(CASA_BUCKET).upload(path, bytes, { contentType: check.kind.mime, upsert: false });
  if (error) return { ok: false as const, erro: "Não foi possível enviar o arquivo. Tente de novo." };
  return { ok: true as const, uploaded: { path, mime: check.kind.mime, size: bytes.length } };
}

async function removeFile(db: Db, path: string | null | undefined) {
  if (path && isCasaDocPath(path)) await db.storage.from(CASA_BUCKET).remove([path]);
}

/** Novo ou edição. Arquivo novo que não foi referenciado (erro ou 0 linhas) é apagado; o antigo só sai depois do sucesso. */
export async function saveCasaDocument(_: DocState, form: FormData): Promise<DocState> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  const parsed = validateDocumentInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Documento inválido." };
  const db = await createClient();

  let old: { file_path: string | null } | null = null;
  if (id) {
    const { data } = await db.from("casa_documents").select("file_path").eq("household_id", hh).eq("id", id).maybeSingle();
    if (!data) return { error: NOT_FOUND };
    old = data;
  }
  const up = await uploadFile(db, hh, form);
  if (!up.ok) return { error: up.erro };

  const removeOld = form.get("remove_file") === "on" && !up.uploaded;
  const fileCols = up.uploaded
    ? { file_path: up.uploaded.path, file_mime: up.uploaded.mime, file_size: up.uploaded.size }
    : removeOld
      ? { file_path: null, file_mime: null, file_size: null }
      : {};

  let failed: string | null = null;
  if (id) {
    const { data, error } = await db.from("casa_documents").update({ ...parsed.value, ...fileCols }).eq("household_id", hh).eq("id", id).select("id");
    if (error) failed = GENERIC;
    else if (!data || data.length === 0) failed = NOT_FOUND;
  } else {
    const { error } = await db.from("casa_documents").insert({ ...parsed.value, ...fileCols, household_id: hh });
    if (error) failed = GENERIC;
  }
  if (failed) {
    await removeFile(db, up.uploaded?.path); // arquivo órfão
    return { error: failed };
  }
  if ((up.uploaded || removeOld) && old) await removeFile(db, old.file_path);
  refresh();
  return { ok: true, message: id ? "Documento atualizado." : "Documento salvo." };
}

export async function deleteCasaDocument(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: "Documento inválido." };
  const db = await createClient();
  const { data, error } = await db.from("casa_documents").delete().eq("household_id", ctx.household.id).eq("id", id).select("file_path");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: NOT_FOUND };
  await removeFile(db, data[0].file_path as string | null);
  refresh();
  return { ok: true };
}
