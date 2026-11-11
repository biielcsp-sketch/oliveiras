"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { formToObject, isUuid, validateProviderInput } from "@/lib/casa/input";

export type ProviderState = { ok?: boolean; error?: string; message?: string } | null;
type Result = { ok: boolean; erro?: string };

const GENERIC = "Não foi possível salvar. Tente de novo.";

export async function saveProvider(_: ProviderState, form: FormData): Promise<ProviderState> {
  const ctx = await getAppContext();
  const parsed = validateProviderInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Prestador inválido." };
  const db = await createClient();
  if (id) {
    const { data, error } = await db.from("casa_providers").update(parsed.value).eq("household_id", ctx.household.id).eq("id", id).select("id");
    if (error) return { error: GENERIC };
    if (!data || data.length === 0) return { error: "Prestador não encontrado." };
  } else {
    const { error } = await db.from("casa_providers").insert({ ...parsed.value, household_id: ctx.household.id });
    if (error) return { error: GENERIC };
  }
  revalidatePath("/casa", "layout");
  return { ok: true, message: id ? "Prestador atualizado." : "Prestador salvo." };
}

/** Manutenções ligadas a ele ficam sem prestador (FK on delete set null). */
export async function deleteProvider(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: "Prestador inválido." };
  const db = await createClient();
  const { data, error } = await db.from("casa_providers").delete().eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: "Prestador não encontrado." };
  revalidatePath("/casa", "layout");
  return { ok: true };
}
