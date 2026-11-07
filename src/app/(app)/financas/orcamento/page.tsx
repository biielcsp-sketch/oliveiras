import { Card } from "@/components/ui";
import { getFinanceBase, getTransactions } from "@/lib/financas/data";
import { getBudgetRows } from "@/lib/financas/planning-data";
import { resolveBudgets } from "@/lib/financas/planning";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth } from "@/lib/financas/period";
import { MonthSwitcher } from "../_components/month-switcher";
import { BudgetRow } from "../_components/budget-row";

export const metadata = { title: "Orçamento" };

export default async function OrcamentoPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const month = parseMonth((await searchParams).mes);
  const [{ accounts, categories }, transactions, rows] = await Promise.all([
    getFinanceBase(),
    getTransactions({ month }),
    getBudgetRows(),
  ]);
  const cards = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const spentBy = new Map(summarize(transactions, categories, cards).expenseByCategory.map((e) => [e.category_id, e.total]));
  const budgets = resolveBudgets(rows, month);

  const expenseCats = categories.filter((c) => c.kind === "despesa");
  const withBudget = expenseCats.filter((c) => budgets.has(c.id));
  const without = expenseCats.filter((c) => !budgets.has(c.id));
  const totalBudget = withBudget.reduce((s, c) => s + Math.round((budgets.get(c.id)?.amount ?? 0) * 100), 0) / 100;
  const totalSpent = withBudget.reduce((s, c) => s + Math.round((spentBy.get(c.id) ?? 0) * 100), 0) / 100;

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} basePath="/financas/orcamento" />

      <Card className="p-4">
        <p className="text-[13px] text-muted">Gasto nas categorias com orçamento</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {formatBRL(totalSpent)} <span className="text-base font-normal text-muted">de {formatBRL(totalBudget)}</span>
        </p>
        {spentBy.get(null) ? (
          <p className="mt-1 text-[13px] text-muted">
            {formatBRL(spentBy.get(null) ?? 0)} em lançamentos sem categoria não entram aqui.
          </p>
        ) : null}
      </Card>

      <Card className="py-1">
        <p className="pt-3 text-[13px] text-muted">Toque numa categoria para definir o valor.</p>
        <ul className="divide-y divide-line">
          {[...withBudget, ...without].map((c) => (
            <BudgetRow
              key={c.id}
              categoryId={c.id}
              name={c.name}
              color={c.color}
              month={month}
              spent={spentBy.get(c.id) ?? 0}
              budget={budgets.get(c.id)}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}
