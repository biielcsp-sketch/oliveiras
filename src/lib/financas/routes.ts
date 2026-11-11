/** Rotas das contas fixas. A antiga /financas/contas-a-pagar redireciona para cá (links antigos e PWA). */
export const CONTAS_FIXAS = "/financas/contas-fixas";

const SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Caminho novo equivalente ao antigo: /financas/contas-a-pagar/{...rest}?{query} → /financas/contas-fixas/{...rest}?{query}.
 * Só aceita segmentos simples (uuid, "nova", "pagar"); qualquer outra coisa cai na lista. Sempre caminho
 * relativo do próprio app (sem host), então não vira redirecionamento aberto.
 */
export function legacyContasPath(rest: string[] | undefined, search: string) {
  const parts = rest ?? [];
  const ok = parts.length <= 3 && parts.every((p) => SEGMENT.test(p));
  const path = ok && parts.length ? `${CONTAS_FIXAS}/${parts.join("/")}` : CONTAS_FIXAS;
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${path}${query}`;
}
