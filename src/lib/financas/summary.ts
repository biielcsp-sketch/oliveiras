import type { Category, Transaction } from "./types";

export type Flow = "income" | "expense";
type FlowTx = Pick<Transaction, "amount" | "category_id" | "account_id"> & { transfer_group?: string | null };

/**
 * Classifica um lançamento como entrada, saída ou fora dos totais (null). Regra única de `summarize`
 * e do filtro por fluxo (o `amount` já vem assinado pelo tipo DEBIT/CREDIT na importação).
 */
export function classifyFlow(
  t: FlowTx,
  kindById: Map<string, Category["kind"]>,
  cardAccountIds: Set<string> = new Set(),
): Flow | null {
  const kind = t.category_id ? kindById.get(t.category_id) : undefined;
  const cents = Math.round(t.amount * 100);
  if (kind === "transferencia" || t.transfer_group) return null;
  if (cents > 0 && !kind && cardAccountIds.has(t.account_id)) return null;
  if (kind === "despesa" || (cents < 0 && kind !== "receita")) return "expense";
  return "income";
}

/**
 * Totais do mês.
 * - Categoria de transferência (ex.: pagamento de cartão) fica fora de entradas e saídas.
 * - Perna de um par de transferência (transfer_group preenchido) também fica fora.
 * - Crédito sem categoria em cartão (pagamento da fatura ou estorno) também fica fora:
 *   o dinheiro já foi contado quando saiu da conta corrente.
 * - Valor positivo em categoria de despesa (estorno categorizado) abate a despesa.
 */
export function summarize(txs: Transaction[], categories: Category[], cardAccountIds: Set<string> = new Set()) {
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  let income = 0;
  let expense = 0;
  const byCategory = new Map<string | null, number>();
  for (const t of txs) {
    const flow = classifyFlow(t, kindById, cardAccountIds);
    if (!flow) continue;
    const cents = Math.round(t.amount * 100);
    if (flow === "expense") {
      expense -= cents;
      byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) - cents);
    } else {
      income += cents;
    }
  }
  return {
    income: income / 100,
    expense: expense / 100,
    result: (income - expense) / 100,
    expenseByCategory: [...byCategory.entries()]
      .filter(([, cents]) => cents > 0)
      .map(([category_id, cents]) => ({ category_id, total: cents / 100 }))
      .sort((a, b) => b.total - a.total),
  };
}
