import "server-only";
import { DRIVE_SCOPE, googleCredentials, googleEndpoints, GOOGLE_ISSUERS, GOOGLE_SCOPES, REQUIRED_SCOPES } from "./config";
import { pkceChallenge, randomToken, safeEqual } from "./crypto";

/**
 * OAuth 2.0 do Google para apps de servidor, com PKCE (S256) e state.
 * Fluxo: /api/google/connect → accounts.google.com → /api/google/callback → token endpoint.
 */
export const STATE_COOKIE = "g_oauth";
export const STATE_COOKIE_PATH = "/api/google";
export const STATE_TTL_S = 600;

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/* ---------- state + PKCE em cookie ---------- */

/** `drive`: pedido do Carisma (escopo extra do Drive e volta para /ministerio/carisma). */
export type OAuthState = { state: string; verifier: string; uid: string; exp: number; drive?: boolean };

export function newOAuthState(uid: string, now = Date.now(), opts: { drive?: boolean } = {}): OAuthState {
  const s: OAuthState = { state: randomToken(), verifier: randomToken(48), uid, exp: now + STATE_TTL_S * 1000 };
  if (opts.drive) s.drive = true;
  return s;
}

export const encodeState = (s: OAuthState) => Buffer.from(JSON.stringify(s), "utf8").toString("base64url");

export function decodeState(raw: string | undefined | null): OAuthState | null {
  if (!raw || raw.length > 1000) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof v?.state !== "string" || typeof v?.verifier !== "string" || typeof v?.uid !== "string" || typeof v?.exp !== "number") {
      return null;
    }
    if (v.drive !== undefined && v.drive !== true) return null;
    return v as OAuthState;
  } catch {
    return null;
  }
}

/** state da URL confere com o do cookie (tempo constante), não venceu e é do mesmo usuário logado. */
export function checkState(cookie: OAuthState | null, stateParam: string | null, uid: string, now = Date.now()) {
  return Boolean(cookie) && safeEqual(cookie!.state, stateParam) && cookie!.uid === uid && cookie!.exp > now;
}

export function buildAuthUrl(s: OAuthState, redirectUri: string, env?: Record<string, string | undefined>) {
  const { clientId } = googleCredentials(env);
  const url = new URL(googleEndpoints(env).authorize);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // Drive (Carisma): mesmos escopos da Agenda + drive.file; include_granted_scopes mantém o que já foi dado.
    scope: (s.drive ? [...GOOGLE_SCOPES, DRIVE_SCOPE] : [...GOOGLE_SCOPES]).join(" "),
    state: s.state,
    code_challenge: pkceChallenge(s.verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();
  return url.toString();
}

/* ---------- token endpoint ---------- */

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
};

async function postForm(url: string, body: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
}

export type IdentityClaims = { sub: string; email: string };

/**
 * Valida as claims do id_token recebido DIRETO do token endpoint por HTTPS
 * (a doc do OpenID Connect do Google dispensa verificar a assinatura nesse caso):
 * iss do Google, aud = nosso client id, exp no futuro, sub e email presentes.
 */
export function parseIdToken(idToken: unknown, clientId: string, now = Date.now()): IdentityClaims {
  // Sem id_token ou sem email = usuário desmarcou openid/email no consentimento: mesmo erro de permissões faltando.
  if (typeof idToken !== "string") throw new GoogleOAuthError("permissões faltando", "missing_scopes");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new GoogleOAuthError("id_token inválido");
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new GoogleOAuthError("id_token inválido");
  }
  if (!GOOGLE_ISSUERS.includes(String(c.iss))) throw new GoogleOAuthError("iss inválido");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId)) throw new GoogleOAuthError("aud inválido");
  if (typeof c.exp !== "number" || c.exp * 1000 <= now) throw new GoogleOAuthError("id_token vencido");
  if (typeof c.sub !== "string" || !c.sub || c.sub.length > 255) throw new GoogleOAuthError("sub inválido");
  if (typeof c.email !== "string" || !c.email || c.email.length > 320) throw new GoogleOAuthError("permissões faltando", "missing_scopes");
  return { sub: c.sub, email: c.email.toLowerCase() };
}

export function missingScopes(granted: string | undefined) {
  const set = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.filter((s) => !set.has(s));
}

export async function exchangeCode(code: string, verifier: string, redirectUri: string) {
  const { clientId, clientSecret } = googleCredentials();
  const res = await postForm(googleEndpoints().token, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) throw new GoogleOAuthError("troca do código recusada", body.error);
  if (!body.refresh_token) throw new GoogleOAuthError("sem refresh token", "no_refresh_token");
  const missing = missingScopes(body.scope);
  if (missing.length) throw new GoogleOAuthError("permissões faltando", "missing_scopes");
  const identity = parseIdToken(body.id_token, clientId);
  return {
    accessToken: body.access_token,
    expiresIn: Number(body.expires_in) || 3600,
    refreshToken: body.refresh_token,
    scope: body.scope ?? "",
    identity,
  };
}

/* ---------- token de acesso (cache em memória por conta) ---------- */

const accessCache = new Map<string, { token: string; expiresAt: number }>();
const cacheKey = (accountId: string, ciphertext: string) => `${accountId}:${ciphertext.slice(-24)}`;

export function rememberAccessToken(accountId: string, ciphertext: string, token: string, expiresIn: number) {
  // Renova 2 minutos antes de vencer.
  accessCache.set(cacheKey(accountId, ciphertext), { token, expiresAt: Date.now() + Math.max(0, expiresIn - 120) * 1000 });
}

export function forgetAccessToken(accountId: string) {
  for (const k of accessCache.keys()) if (k.startsWith(`${accountId}:`)) accessCache.delete(k);
}

/** Troca o refresh token por um token de acesso. `invalid_grant` = revogado/expirado (GoogleOAuthError code). */
export async function accessTokenFor(accountId: string, ciphertext: string, refreshToken: () => string) {
  const hit = accessCache.get(cacheKey(accountId, ciphertext));
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const { clientId, clientSecret } = googleCredentials();
  const res = await postForm(googleEndpoints().token, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken(),
    grant_type: "refresh_token",
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    forgetAccessToken(accountId);
    throw new GoogleOAuthError("refresh recusado", body.error ?? `http_${res.status}`);
  }
  rememberAccessToken(accountId, ciphertext, body.access_token, Number(body.expires_in) || 3600);
  return body.access_token;
}

/** Revoga no Google (POST /revoke, token no corpo). Revogar o refresh token derruba os tokens de acesso. */
export async function revokeToken(token: string) {
  const res = await postForm(googleEndpoints().revoke, { token });
  if (res.ok) return true;
  // 400 invalid_token = já estava revogado; qualquer outro 400 é falha de revogação.
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error === "invalid_token";
  }
  return false;
}
