import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, EmptyState, IncompleteNotice, LinkButton, SectionHeader, SeeAll } from "@/components/ui";
import { BlockTitle } from "@/components/module-home";
import { budgetHighlights } from "@/lib/financas/budget-highlights";
import { donutSlices } from "@/lib/financas/donut";
import { getFinanceBase, getTransactions } from "@/lib/financas/data";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { monthLabel, parseMonth } from "@/lib/financas/period";
import { getBillPayments, getBills, getBudgetRows, getTransactionsAround } from "@/lib/financas/planning-data";
import { dateInMonth, invoiceFor, invoiceTotals, resolveBudgets } from "@/lib/financas/planning";
import { todaySP } from "@/lib/financas/today";
import { MonthSwitcher } from "./_components/month-switcher";
import { BudgetSummary } from "./_components/budget-summary";
import { DueCards, type Due } from "./_components/due-cards";
import { QuickActions } from "./_components/quick-actions";
import { accountTotals } from "@/lib/financas/contas-view";
import { ResumoSaldo } from "./_components/resumo-saldo";
import { TxList } from "./_components/tx-list";

export const metadata = { title: "Finanças" };

export default async function FinancasPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const month = parseMonth((await searchParams).mes);
  const [{ accounts, categories }, transactions] = await Promise.all([
    getFinanceBase(),
    getTransactions({ month }),
  ]);

  if (accounts.length === 0) {
    return (
      <EmptyState title="Comece cadastrando suas contas e cartões">
        <p>Depois você lança gastos à mão ou importa o extrato em OFX/CSV.</p>
        <LinkButton href="/financas/contas/nova" className="mt-4">
          <Plus size={16} /> Nova conta
        </LinkButton>
      </EmptyState>
    );
  }

  const active = accounts.filter((a) => !a.archived);
  const { available, cardDebt } = accountTotals(active);
  const cards = active.filter((a) => a.kind === "cartao");
  const cardIds = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const { income, expense, result, expenseByCategory } = summarize(transactions, categories, cardIds);

  // Vencimentos do mês (contas fixas + faturas) e orçamento
  const today = todaySP();
  const billingCards = cards.filter((c) => c.closing_day && c.due_day);
  const [bills, payments, cardTxs, budgetRows] = await Promise.all([
    getBills(),
    getBillPayments(month),
    getTransactionsAround(month, billingCards.map((c) => c.id)),
    getBudgetRows(),
  ]);
  const paid = new Set(payments.map((p) => p.bill_id));
  const transferIds = new Set(categories.filter((c) => c.kind === "transferencia").map((c) => c.id));
  const budgets = resolveBudgets(budgetRows, month);
  const spentBy = new Map(expenseByCategory.map((e) => [e.category_id, e.total]));
  let budgetTotal = 0;
  let budgetSpent = 0;
  budgets.forEach((b, catId) => {
    budgetTotal += Math.round(b.amount * 100);
    budgetSpent += Math.round((spentBy.get(catId) ?? 0) * 100);
  });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const slices = donutSlices(expenseByCategory, (id) => (id ? catById.get(id)?.name ?? "Sem categoria" : "Sem categoria"));

  const topBudgets = budgetHighlights(budgets, spentBy, (id) => catById.get(id)?.name ?? "Sem categoria");
  const dueItems: Due[] = [
    ...bills
      .filter((b) => b.active && !paid.has(b.id))
      .map((b) => ({ key: b.id, name: b.name, due: dateInMonth(month, b.due_day), amount: b.amount, kind: "conta" as const })),
    ...billingCards.flatMap((c) => {
      const inv = invoiceFor(month, c.closing_day!, c.due_day!);
      const t = invoiceTotals(cardTxs.filter((x) => x.account_id === c.id), transferIds, inv);
      return t.total > 0 && t.paid < t.total
        ? [{ key: c.id, name: `Fatura ${c.name}`, due: inv.due, amount: Math.round((t.total - t.paid) * 100) / 100, kind: "fatura" as const }]
        : [];
    }),
  ].sort((a, b) => a.due.localeCompare(b.due));

  return (
    <div className="flex flex-col gap-6">
      <ResumoSaldo
        available={formatBRL(available)}
        cardDebt={cards.length > 0 ? formatBRL(cardDebt) : null}
        income={formatBRL(income)}
        expense={formatBRL(-expense)}
        result={formatBRL(result)}
        caption={monthLabel(month)}
      />

      <QuickActions month={month} />

      <MonthSwitcher month={month} basePath="/financas" />

      <IncompleteNotice show={transactions.incomplete || cardTxs.incomplete} />

      {slices.length > 0 && (
        <section>
          <BlockTitle action={<SeeAll href={`/financas/orcamento?mes=${month}`}>Ver detalhes</SeeAll>}>Despesas por categoria</BlockTitle>
          <Card className="p-4">
            <div className="flex items-center gap-5">
              <div className="relative shrink-0">
                <svg width="132" height="132" viewBox="0 0 42 42" aria-hidden="true" className="-rotate-90">
                  <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--surface-2)" strokeWidth="5" />
                  {slices.map((sl) => (
                    <circle
                      key={sl.key}
                      cx="21"
                      cy="21"
                      r="15.9"
                      fill="none"
                      stroke={sl.color}
                      strokeWidth="5"
                      strokeDasharray={sl.dash}
                      strokeDashoffset={sl.offset}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-[10px] text-muted">Total do mês</p>
                    <p className="text-[12.5px] font-bold tabular-nums">{formatBRL(expense)}</p>
                  </div>
                </div>
              </div>
              <ul className="flex min-w-0 flex-1 flex-col gap-1">
                {slices.map((sl) => {
                  const row = (
                    <>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: sl.color }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{sl.label}</span>
                      <span className="sr-only">{formatBRL(sl.total)}, </span>
                      <span className="font-bold tabular-nums">{sl.pct}%</span>
                    </>
                  );
                  return (
                    <li key={sl.key}>
                      {sl.key === "outros" ? (
                        <span className="flex min-h-9 items-center gap-2.5 text-[13.5px]">{row}</span>
                      ) : (
                        <Link
                          href={`/financas/lancamentos?mes=${month}&categoria=${sl.categoryId ?? "sem"}`}
                          className="flex min-h-9 items-center gap-2.5 rounded-xl text-[13.5px] hover:text-primary"
                        >
                          {row}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Card>
        </section>
      )}

      {budgetTotal > 0 && <BudgetSummary month={month} spent={budgetSpent / 100} total={budgetTotal / 100} rows={topBudgets} />}

      {dueItems.length > 0 && (
        <section>
          <SectionHeader
            title="A pagar neste mês"
            count={dueItems.length}
            href={`/financas/contas-fixas?mes=${month}`}
            linkLabel="Ver contas"
          />
          <DueCards dues={dueItems.slice(0, 6)} month={month} today={today} />
        </section>
      )}

      <section>
        <BlockTitle action={<SeeAll href={`/financas/lancamentos?mes=${month}`}>Ver todas</SeeAll>}>Últimas movimentações</BlockTitle>
        <Card className="py-2">
          {transactions.length > 0 ? (
            <TxList transactions={transactions.slice(0, 6)} accounts={accounts} categories={categories} />
          ) : (
            <p className="py-3 text-sm text-muted">Nenhum lançamento neste mês.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
