"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/data";

export type OnboardState = { error?: string } | null;

export async function createHousehold(_: OnboardState, form: FormData): Promise<OnboardState> {
  await getUser();
  const family = String(form.get("family") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  if (!family || !name) return { error: "Preencha os dois campos." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_household", { p_name: family, p_member_name: name });
  if (error) return { error: "Não foi possível criar a família." };
  redirect("/inicio");
}

export async function joinHousehold(_: OnboardState, form: FormData): Promise<OnboardState> {
  await getUser();
  const code = String(form.get("code") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  if (!code || !name) return { error: "Preencha os dois campos." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_household", { p_code: code, p_member_name: name });
  if (error) return { error: error.message.includes("código") ? "Código inválido." : "Não foi possível entrar." };
  redirect("/inicio");
}
