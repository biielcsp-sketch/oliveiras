"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { formToObject, isUuid, validateDocumentInput } from "@/lib/casa/input";
import { fileColumns, removeCasaFile, uploadCasaFile } from "@/lib/casa/storage";

/**
 * Documentos e garantias da Casa. Mesmo padrão de upload da Saúde/Finanças: tipo decidido pelos BYTES (PDF/JPG),
 * até 5 MB, nome uuid gerado aqui, envio com a sessão do usuário (RLS do bucket privado `casa`).
 * A IA NÃO lê estes documentos.
 */
export type DocState = { ok?: boolean; error?: string; message?: string } | null;
type Result = { ok: boolean; erro?: string };

const GENERIC = "Não foi possível salvar. Tente de novo.";
const NOT_FOUND = "Documento não encontrado.";

function refresh() {
  revalidatePath("/casa", "layout");
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
  const up = await uploadCasaFile(db, hh, form, "docs");
  if (!up.ok) return { error: up.erro };

  const removeOld = form.get("remove_file") === "on" && !up.uploaded;
  const fileCols = fileColumns(up.uploaded, removeOld);

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
    await removeCasaFile(db, up.uploaded?.path, "docs"); // arquivo órfão
    return { error: failed };
  }
  if ((up.uploaded || removeOld) && old) await removeCasaFile(db, old.file_path, "docs");
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
  await removeCasaFile(db, data[0].file_path as string | null, "docs");
  refresh();
  return { ok: true };
}
