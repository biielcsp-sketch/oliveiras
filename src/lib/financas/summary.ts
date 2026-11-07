import type { Category, Transaction } from "./types";

/** Totais do mês: transferências (ex.: pagamento de fatura) ficam fora de entradas e saídas. */
export function summarize(txs: Transaction[], categories: Category[]) {
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  let income = 0;
  let expense = 0;
  const byCategory = new Map<string | null, number>();
  for (const t of txs) {
    const kind = t.category_id ? kindById.get(t.category_id) : undefined;
    if (kind === "transferencia") continue;
    const cents = Math.round(t.amount * 100);
    if (cents > 0) income += cents;
    else {
      expense += -cents;
      byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) - cents);
    }
  }
  return {
    income: income / 100,
    expense: expense / 100,
    result: (income - expense) / 100,
    expenseByCategory: [...byCategory.entries()]
      .map(([category_id, cents]) => ({ category_id, total: cents / 100 }))
      .sort((a, b) => b.total - a.total),
  };
}
