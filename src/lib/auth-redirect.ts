/** Destino padrão do link de confirmação de e-mail. */
export const DEFAULT_AFTER_AUTH = "/bem-vindo";

/** Únicos destinos aceitos no parâmetro `next` do /auth/callback (lista fechada: sem open redirect). */
const ALLOWED_NEXT = new Set(["/redefinir-senha"]);

/** Devolve um caminho interno seguro: só valores exatos da lista permitida; o resto cai no padrão. */
export function safeNextPath(next: string | null | undefined): string {
  return typeof next === "string" && ALLOWED_NEXT.has(next) ? next : DEFAULT_AFTER_AUTH;
}

/**
 * Destino quando a troca do código falha no /auth/callback. O navegador pode abrir o link duas vezes
 * ao mesmo tempo: a 1ª troca cria a sessão e a 2ª falha (código já usado). No fluxo de redefinição,
 * seguimos para a página, que decide pela sessão (sem ela, ela mesma volta ao login com aviso).
 */
export function callbackFailurePath(next: string | null | undefined): string {
  return typeof next === "string" && ALLOWED_NEXT.has(next) ? next : "/login?erro=link";
}
