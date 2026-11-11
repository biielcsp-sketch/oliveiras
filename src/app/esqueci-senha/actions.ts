"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type ResetRequestState = { info?: string; error?: string } | null;

// Sempre a mesma resposta, exista a conta ou não (sem enumeração de usuários).
const RESET_REQUEST_MESSAGE = "Se esse e-mail tiver conta, enviamos um link para redefinir a senha.";

export async function requestPasswordReset(_: ResetRequestState, form: FormData): Promise<ResetRequestState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Informe o seu e-mail." };

  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await createClient();
  // O resultado é ignorado de propósito: erro ou sucesso, a resposta ao usuário é a mesma.
  await supabase.auth
    .resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/redefinir-senha` })
    .catch(() => undefined);
  return { info: RESET_REQUEST_MESSAGE };
}
