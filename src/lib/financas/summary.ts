import type { Category, Transaction } from "./types";

/**
 * Totais do mês.
 * - Categoria de transferência (ex.: pagamento de fatura) fica fora de entradas e saídas.
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
    const kind = t.category_id ? kindById.get(t.category_id) : undefined;
    const cents = Math.round(t.amount * 100);
    if (kind === "transferencia") continue;
    if (cents > 0 && !kind && cardAccountIds.has(t.account_id)) continue;
    if (kind === "despesa" || (cents < 0 && kind !== "receita")) {
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
