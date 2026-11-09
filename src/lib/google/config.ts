import "server-only";

/**
 * Endereços e credenciais do Google (OAuth 2.0 para apps de servidor + Calendar API v3).
 * GOOGLE_OAUTH_BASE / GOOGLE_API_BASE existem só para os testes (servidor simulado):
 * fora do padrão, só aceitamos localhost.
 */
export const GOOGLE_DEFAULTS = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://www.googleapis.com/calendar/v3",
} as const;

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;
/** Sem estes dois a Agenda não funciona (a tela de consentimento permite desmarcar). */
export const REQUIRED_SCOPES = GOOGLE_SCOPES.slice(2);

export class GoogleConfigError extends Error {}

type Env = Record<string, string | undefined>;

/** Base de teste: só http(s) em localhost/127.0.0.1, sem credenciais nem query. */
export function testBase(raw: string | undefined, name: string): string | null {
  const v = raw?.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new GoogleConfigError(`${name} inválida.`);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || !/^https?:$/.test(u.protocol) || u.username || u.search) {
    throw new GoogleConfigError(`${name} só aceita localhost (é para testes).`);
  }
  return v.replace(/\/+$/, "");
}

export function googleEndpoints(env: Env = process.env) {
  const oauth = testBase(env.GOOGLE_OAUTH_BASE, "GOOGLE_OAUTH_BASE");
  const api = testBase(env.GOOGLE_API_BASE, "GOOGLE_API_BASE");
  return {
    authorize: oauth ? `${oauth}/o/oauth2/v2/auth` : GOOGLE_DEFAULTS.authorize,
    token: oauth ? `${oauth}/token` : GOOGLE_DEFAULTS.token,
    revoke: oauth ? `${oauth}/revoke` : GOOGLE_DEFAULTS.revoke,
    api: api ?? GOOGLE_DEFAULTS.api,
  };
}

export function googleCredentials(env: Env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new GoogleConfigError("Google não configurado no servidor.");
  return { clientId, clientSecret };
}

export function googleConfigured(env: Env = process.env) {
  try {
    googleCredentials(env);
    googleEndpoints(env);
    return true;
  } catch {
    return false;
  }
}
