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

/** Para onde voltar depois de salvar a conta fixa: só destinos fixos (nunca um caminho vindo do formulário). */
export const billReturnPath = (voltar: unknown) => (voltar === "casa" ? "/casa/contas" : CONTAS_FIXAS);

export const CASA_CONTAS = "/casa/contas";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Origem do fluxo de documentos/exclusão: lista fechada ("casa" ou nenhuma). Qualquer outro valor vira nenhuma. */
export const flowOrigin = (v: unknown): "casa" | null => (v === "casa" ? "casa" : null);

/** Mês do fluxo (AAAA-MM) vindo da URL/formulário: só valor válido; qualquer outra coisa vira nenhum. */
export const flowMonth = (v: unknown) => (typeof v === "string" && MONTH_RE.test(v) ? v : undefined);

/** Contas da casa, mantendo o mês só se for AAAA-MM válido (nunca ecoa valor da URL). */
export const casaContasPath = (mes?: unknown) => (typeof mes === "string" && MONTH_RE.test(mes) ? `${CASA_CONTAS}?mes=${mes}` : CASA_CONTAS);

/** Destino ao concluir o fluxo: da Casa volta para Casa > Contas (mês mantido); senão o destino das Finanças. */
export const flowReturnPath = (origem: unknown, financasPath: string, mes?: unknown) =>
  flowOrigin(origem) === "casa" ? casaContasPath(mes) : financasPath;

/**
 * Tela de conferência do documento. Enviado pela Casa: abre dentro da Casa (aba Contas e menu da Casa marcados),
 * mantendo o mês só se for AAAA-MM válido. Sem origem (Finanças, "+" do Oli) ou origem inválida: nas Finanças.
 */
export const docReviewPath = (id: string, origem?: unknown, mes?: unknown) => {
  if (flowOrigin(origem) !== "casa") return `/financas/documentos/${id}`;
  const base = `${CASA_CONTAS}/documento/${id}`;
  return typeof mes === "string" && MONTH_RE.test(mes) ? `${base}?mes=${mes}` : base;
};

/** Tela de confirmação para apagar o documento: pela Casa fica na Casa (mesmas regras de `docReviewPath`). */
export const docDeletePath = (id: string, origem?: unknown, mes?: unknown) => {
  const [path, query] = docReviewPath(id, origem, mes).split("?");
  return `${path}/apagar${query ? `?${query}` : ""}`;
};

/** Tela de confirmação para excluir a conta fixa (id é validado como uuid na própria tela e na ação). */
export const billDeletePath = (id: string, origem?: unknown, mes?: unknown) => {
  const q = new URLSearchParams();
  if (flowOrigin(origem) === "casa") q.set("voltar", "casa");
  if (typeof mes === "string" && MONTH_RE.test(mes)) q.set("mes", mes);
  const s = q.toString();
  return `${CONTAS_FIXAS}/${id}/excluir${s ? `?${s}` : ""}`;
};

/** Conta avulsa (0021): edição, pagamento e exclusão ficam sob Contas fixas (mesma aba do menu). */
export const oneOffPath = (id: string) => `${CONTAS_FIXAS}/avulsa/${id}`;

/** Tela de confirmação para apagar a conta avulsa (id validado como uuid na tela e na ação). */
export const oneOffDeletePath = (id: string, origem?: unknown, mes?: unknown) => {
  const q = new URLSearchParams();
  if (flowOrigin(origem) === "casa") q.set("voltar", "casa");
  if (typeof mes === "string" && MONTH_RE.test(mes)) q.set("mes", mes);
  const s = q.toString();
  return `${oneOffPath(id)}/excluir${s ? `?${s}` : ""}`;
};
