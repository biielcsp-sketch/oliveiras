import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Criptografia do refresh token do Google (AES-256-GCM).
 * Chave: HKDF-SHA256 do GOOGLE_CLIENT_SECRET (sem outra variável secreta).
 *   salt = "oliveiras/google-token/v1", info = "aes-256-gcm refresh-token".
 * ATENÇÃO: trocar o GOOGLE_CLIENT_SECRET invalida os tokens guardados; cada pessoa precisa reconectar.
 * Formato: v1.<iv>.<ciphertext>.<tag> (base64url; iv de 12 bytes, tag de 16).
 * AAD = "<household_id>:<google_sub>": o texto cifrado só abre na linha da conta certa
 * (copiar o token de uma conta para outra não funciona).
 */
const VERSION = "v1";
const SALT = "oliveiras/google-token/v1";
const INFO = "aes-256-gcm refresh-token";

export class TokenCryptoError extends Error {}

export function deriveTokenKey(secret: string) {
  if (!secret) throw new TokenCryptoError("segredo ausente");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from(SALT), Buffer.from(INFO), 32));
}

export const tokenAad = (householdId: string, googleSub: string) => `${householdId}:${googleSub}`;

export function sealToken(plain: string, secret: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveTokenKey(secret), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

const B64URL = /^[A-Za-z0-9_-]+$/;

export function openToken(sealed: string, secret: string, aad: string) {
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  if (parts.length !== 4 || parts[0] !== VERSION || !parts.slice(1).every((p) => B64URL.test(p))) {
    throw new TokenCryptoError("formato inválido");
  }
  const [, ivB, ctB, tagB] = parts;
  const iv = Buffer.from(ivB, "base64url");
  const tag = Buffer.from(tagB, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new TokenCryptoError("formato inválido");
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveTokenKey(secret), iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("token adulterado ou chave errada");
  }
}

/* ---------- PKCE (RFC 7636) e state ---------- */

/** 32 bytes aleatórios → 43 caracteres base64url (dentro de 43–128 exigidos para o code_verifier). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** code_challenge = BASE64URL(SHA256(code_verifier)), método S256. */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url");

/** Comparação em tempo constante (compara os hashes, então tamanhos diferentes não vazam). */
export function safeEqual(a: unknown, b: unknown) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
