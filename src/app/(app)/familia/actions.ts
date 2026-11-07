"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";

export type ActionState = { error?: string; ok?: boolean } | null;

const RELATIONS = ["filho", "outro"] as const;

export async function addDependent(_: ActionState, form: FormData): Promise<ActionState> {
  const { household } = await getAppContext();
  const name = String(form.get("name") ?? "").trim();
  const relation = String(form.get("relation") ?? "filho");
  const birth = String(form.get("birth_date") ?? "") || null;

  if (!name) return { error: "Informe o nome." };
  if (!RELATIONS.includes(relation as (typeof RELATIONS)[number])) return { error: "Relação inválida." };

  const supabase = await createClient();
  const { error } = await supabase.from("members").insert({
    household_id: household.id,
    name,
    relation,
    birth_date: birth,
    color: "#C08A3E",
  });
  if (error) return { error: "Não foi possível salvar. Tente de novo." };

  revalidatePath("/familia");
  return { ok: true };
}

export async function removeDependent(form: FormData) {
  await getAppContext();
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  // RLS só permite remover membros sem login (dependentes)
  await supabase.from("members").delete().eq("id", id);
  revalidatePath("/familia");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
