/** "Lembrar neste aparelho": o cookie guarda só o e-mail (rótulo de interface), nunca senha, token ou segredo. */
export const REMEMBER_COOKIE = "oliveiras_lembrar";
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 180; // ~180 dias

const EMAIL = /^[^\s@<>"'\\]+@[^\s@<>"'\\]+\.[^\s@<>"'\\]+$/;

/** Devolve o e-mail (minúsculo) se o valor do cookie tiver formato válido; senão null. Nunca autentica nada. */
export function parseRememberedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

/** g***@gmail.com: mostra só a primeira letra do usuário e o domínio. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${Array.from(email.slice(0, at))[0]}***${email.slice(at)}`;
}

export function rememberCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REMEMBER_MAX_AGE,
  };
}
