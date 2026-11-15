/** Contas do Meu Pluggy (cada uma é uma aplicação Pluggy com seu Client ID/Secret, só em variáveis do servidor). */
export const PLUGGY_CREDENTIALS = ["principal", "karen"] as const;
export type PluggyCredential = (typeof PLUGGY_CREDENTIALS)[number];

export const CREDENTIAL_LABEL: Record<PluggyCredential, string> = { principal: "Gabriel", karen: "Karen" };
const CREDENTIAL_OWNER: Record<PluggyCredential, string> = { principal: "do Gabriel", karen: "da Karen" };
export const credentialOwner = (c: PluggyCredential) => CREDENTIAL_OWNER[c];

const ENV_NAMES: Record<PluggyCredential, { id: string; secret: string }> = {
  principal: { id: "PLUGGY_CLIENT_ID", secret: "PLUGGY_CLIENT_SECRET" },
  karen: { id: "PLUGGY_CLIENT_ID_KAREN", secret: "PLUGGY_CLIENT_SECRET_KAREN" },
};

/** Valida contra a lista fechada; qualquer outro valor (inclusive vazio) vira null. */
export function parseCredential(v: unknown): PluggyCredential | null {
  return typeof v === "string" && (PLUGGY_CREDENTIALS as readonly string[]).includes(v) ? (v as PluggyCredential) : null;
}

export function credentialEnvNames(c: PluggyCredential) {
  return ENV_NAMES[c];
}

export function credentialConfigured(c: PluggyCredential, env: Record<string, string | undefined> = process.env) {
  const n = ENV_NAMES[c];
  return Boolean(env[n.id] && env[n.secret]);
}

export function configuredCredentials(env: Record<string, string | undefined> = process.env) {
  return PLUGGY_CREDENTIALS.filter((c) => credentialConfigured(c, env));
}

export type CredentialDecision = { ok: true; credential: PluggyCredential } | { ok: false; error: string };

export const CREDENTIAL_UNKNOWN_MSG = "Conexão com conta do Meu Pluggy desconhecida. Remova a conexão e conecte de novo.";
export const CREDENTIAL_READ_ERROR_MSG =
  "Não foi possível ler as conexões do Open Finance. Confira se a atualização do banco de dados foi aplicada e tente de novo.";

/** Novo item: o campo é obrigatório, tem de estar na lista fechada e configurado no servidor. */
export function credentialForNewItem(raw: unknown, env: Record<string, string | undefined> = process.env): CredentialDecision {
  const credential = parseCredential(raw);
  if (!credential) return { ok: false, error: "Escolha a conta do Meu Pluggy (Gabriel ou Karen)." };
  if (!credentialConfigured(credential, env)) {
    return { ok: false, error: "As credenciais dessa conta do Meu Pluggy não estão configuradas no servidor." };
  }
  return { ok: true, credential };
}

/** Item já gravado: valor desconhecido ou sem credenciais no servidor falha só esse item, com mensagem própria. */
export function credentialForStoredItem(raw: unknown, env: Record<string, string | undefined> = process.env): CredentialDecision {
  const credential = parseCredential(raw);
  if (!credential) return { ok: false, error: CREDENTIAL_UNKNOWN_MSG };
  if (!credentialConfigured(credential, env)) {
    return { ok: false, error: `Credenciais ${credentialOwner(credential)} não configuradas no servidor. Cadastre as variáveis na Vercel e faça um novo deploy.` };
  }
  return { ok: true, credential };
}
