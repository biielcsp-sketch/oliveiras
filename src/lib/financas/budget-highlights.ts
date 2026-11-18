export type BudgetHighlight = {
  categoryId: string;
  name: string;
  spent: number;
  amount: number;
  /** gasto ÷ orçamento (pode passar de 1) */
  ratio: number;
};

/**
 * Categorias com orçamento no mês, da mais pressionada para a menos (gasto ÷ orçamento), para o Resumo das Finanças.
 * `budgets` é o resultado de `resolveBudgets`; `spentBy` traz o gasto do mês por categoria. Orçamento zerado fica de fora.
 */
export function budgetHighlights(
  budgets: Map<string, { amount: number }>,
  spentBy: Map<string | null, number>,
  nameOf: (id: string) => string,
  limit = 3,
): BudgetHighlight[] {
  const rows: BudgetHighlight[] = [];
  budgets.forEach((b, categoryId) => {
    if (!(b.amount > 0)) return;
    const spent = Math.round((spentBy.get(categoryId) ?? 0) * 100) / 100;
    rows.push({ categoryId, name: nameOf(categoryId), spent, amount: b.amount, ratio: spent / b.amount });
  });
  return rows.sort((a, b) => b.ratio - a.ratio || b.amount - a.amount || a.name.localeCompare(b.name, "pt-BR")).slice(0, limit);
}
