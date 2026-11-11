/** Destino padrão do link de confirmação de e-mail. */
export const DEFAULT_AFTER_AUTH = "/bem-vindo";

/** Únicos destinos aceitos no parâmetro `next` do /auth/callback (lista fechada: sem open redirect). */
const ALLOWED_NEXT = new Set(["/redefinir-senha"]);

/** Devolve um caminho interno seguro: só valores exatos da lista permitida; o resto cai no padrão. */
export function safeNextPath(next: string | null | undefined): string {
  return typeof next === "string" && ALLOWED_NEXT.has(next) ? next : DEFAULT_AFTER_AUTH;
}
