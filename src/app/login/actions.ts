"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { REMEMBER_COOKIE, parseRememberedEmail, rememberCookieOptions } from "@/lib/remember";

export type AuthState = { error?: string; info?: string } | null;

function read(form: FormData) {
  return {
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    password: String(form.get("password") ?? ""),
  };
}

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const { email, password } = read(form);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Confirme seu e-mail antes de entrar." };
    return { error: "E-mail ou senha incorretos." };
  }
  // Só depois do login dar certo. O cookie é rótulo de interface (e-mail), nunca credencial.
  const jar = await cookies();
  const remembered = parseRememberedEmail(email);
  if (form.get("remember") === "on" && remembered) {
    jar.set(REMEMBER_COOKIE, remembered, rememberCookieOptions());
  } else if (jar.get(REMEMBER_COOKIE)?.value === email) {
    jar.delete(REMEMBER_COOKIE);
  }
  redirect("/inicio");
}

/** "Não sou eu / Esquecer este aparelho". */
export async function forgetDevice() {
  (await cookies()).delete(REMEMBER_COOKIE);
  redirect("/login");
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const { email, password } = read(form);
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };

  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: "Não foi possível criar a conta. Verifique o e-mail." };

  // Com confirmação de e-mail ligada, ainda não há sessão.
  if (!data.session) return { info: "Enviamos um link de confirmação para o seu e-mail." };
  redirect("/bem-vindo");
}
