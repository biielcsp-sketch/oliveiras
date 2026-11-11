"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type NewPasswordState = { error?: string } | null;

export async function updatePassword(_: NewPasswordState, form: FormData): Promise<NewPasswordState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (password !== confirm) return { error: "As senhas não conferem." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login?erro=link");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível redefinir a senha. Peça um novo link e tente de novo." };
  redirect("/inicio");
}
