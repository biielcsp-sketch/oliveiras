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

export class GoogleConfigError extends Error {}

type Env = Record<string, string | undefined>;

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;
/** Sem estes dois a Agenda não funciona (a tela de consentimento permite desmarcar). */
export const REQUIRED_SCOPES = GOOGLE_SCOPES.slice(2);

/**
 * Google Drive: escopo INCREMENTAL e OPCIONAL (pedido só quando a pessoa conecta o Drive no Carisma).
 * drive.file = só arquivos criados pelo app ou abertos com ele (não lê o resto do Drive).
 * Fica fora de REQUIRED_SCOPES: a Agenda funciona sem ele.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** A conta tem o escopo `scope` na coluna google_accounts.scopes (lista separada por espaço). */
export function hasScope(scopes: string | null | undefined, scope: string) {
  return (scopes ?? "").split(/\s+/).includes(scope);
}

/** Drive API v3 (metadados) e o endpoint de upload. Bases de teste só em localhost, como as do Calendar. */
export const DRIVE_DEFAULTS = {
  api: "https://www.googleapis.com/drive/v3",
  upload: "https://www.googleapis.com/upload/drive/v3",
} as const;

export function driveEndpoints(env: Env = process.env) {
  return {
    api: testBase(env.GOOGLE_DRIVE_API_BASE, "GOOGLE_DRIVE_API_BASE") ?? DRIVE_DEFAULTS.api,
    upload: testBase(env.GOOGLE_DRIVE_UPLOAD_BASE, "GOOGLE_DRIVE_UPLOAD_BASE") ?? DRIVE_DEFAULTS.upload,
  };
}


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
