/**
 * Mensagens curtas, em português, para os erros de entrada/cadastro com digital (passkeys).
 * Recebe o erro do auth-js: AuthError (código do servidor em `code`) ou WebAuthnError
 * (código `ERROR_*` e o erro original do navegador em `cause`).
 */
type PasskeyError = { code?: unknown; name?: unknown; cause?: unknown } | null | undefined;

export const PASSKEY_MSG = {
  cancelled: "Cancelado.",
  notRegistered: "Esta digital não está cadastrada. Entre com a senha e ative em Família.",
  disabled: "Entrada com digital indisponível no momento.",
  signInFailed: "Não foi possível entrar com a digital.",
  loadFailed: "Não foi possível carregar a digital. Tente de novo.",
  alreadyRegistered: "Este aparelho já está cadastrado.",
  tooMany: "Limite de digitais atingido. Remova uma antes de ativar outra.",
  registerFailed: "Não foi possível ativar a digital.",
} as const;

function causeName(err: PasskeyError) {
  const cause = err?.cause as { name?: unknown } | undefined;
  return typeof cause?.name === "string" ? cause.name : undefined;
}

/** Usuário fechou o diálogo do sistema (ou o navegador não achou credencial para oferecer). */
export function isCancelled(err: PasskeyError) {
  return (
    err?.name === "NotAllowedError" ||
    causeName(err) === "NotAllowedError" ||
    err?.code === "ERROR_CEREMONY_ABORTED"
  );
}

export function signInErrorMessage(err: PasskeyError): string {
  if (isCancelled(err)) return PASSKEY_MSG.cancelled;
  // Na entrada, o Auth responde `webauthn_verification_failed` (mensagem genérica, sem
  // revelar se a chave existe) quando a credencial do aparelho não está no servidor,
  // ex.: removida em Família. Com autenticador de plataforma, esse é o caso real; a
  // orientação (entrar com a senha e ativar de novo) serve também para falha de assinatura.
  if (err?.code === "webauthn_credential_not_found" || err?.code === "webauthn_verification_failed")
    return PASSKEY_MSG.notRegistered;
  if (err?.code === "passkey_disabled") return PASSKEY_MSG.disabled;
  return PASSKEY_MSG.signInFailed;
}

export function registerErrorMessage(err: PasskeyError): string {
  if (isCancelled(err)) return PASSKEY_MSG.cancelled;
  if (
    err?.code === "webauthn_credential_exists" ||
    err?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
  )
    return PASSKEY_MSG.alreadyRegistered;
  if (err?.code === "passkey_disabled") return PASSKEY_MSG.disabled;
  if (err?.code === "too_many_passkeys") return PASSKEY_MSG.tooMany;
  return PASSKEY_MSG.registerFailed;
}
