import { PASSKEY_MSG, signInErrorMessage } from "./passkey-errors";

type SignInResult = { data?: { session?: unknown } | null; error?: unknown };
type PasskeyClient = { auth: { signInWithPasskey(): Promise<SignInResult> } };

export type PasskeySignInOutcome = { ok: true } | { ok: false; message: string | null };

/**
 * Entrada com digital. O cliente do Supabase vem de um carregador (import dinâmico no componente):
 * se o chunk falhar (rede, deploy novo), nunca rejeita; devolve `ok: false` para o chamador destravar a tela.
 * `silent` (pedido automático ao abrir): falha sem mensagem.
 */
export async function runPasskeySignIn(
  loadClient: () => Promise<PasskeyClient>,
  silent: boolean,
): Promise<PasskeySignInOutcome> {
  let result: SignInResult;
  try {
    result = await (await loadClient()).auth.signInWithPasskey();
  } catch {
    return { ok: false, message: silent ? null : PASSKEY_MSG.loadFailed };
  }
  if (result.error || !result.data?.session) {
    return { ok: false, message: silent ? null : signInErrorMessage(result.error as Parameters<typeof signInErrorMessage>[0]) };
  }
  return { ok: true };
}
