import Link from "next/link";
import { Plus, Upload, Wallet } from "lucide-react";
import { Card, EmptyState, IncompleteNotice, LinkButton, SectionHeader, SeeAll, Tag } from "@/components/ui";
import { HeroDrawer } from "@/components/hero-drawer";
import { MonthBalance } from "@/components/month-balance";
import { BlockTitle } from "@/components/module-home";
import { donutSlices } from "@/lib/financas/donut";
import { getFinanceBase, getTransactions } from "@/lib/financas/data";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { monthLabel, parseMonth } from "@/lib/financas/period";
import { getBillPayments, getBills, getBudgetRows, getTransactionsAround } from "@/lib/financas/planning-data";
import { billStatus, dateInMonth, invoiceFor, invoiceTotals, resolveBudgets } from "@/lib/financas/planning";
import { shortDate } from "@/lib/financas/period";
import { todaySP } from "@/lib/financas/today";
import { MonthSwitcher } from "./_components/month-switcher";
import { StatusBadge } from "./_components/status-badge";
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
  const available = active.filter((a) => a.kind !== "cartao").reduce((s, a) => s + Math.round(a.balance * 100), 0) / 100;
  const cards = active.filter((a) => a.kind === "cartao");
  const cardDebt = cards.reduce((s, a) => s + Math.round(a.balance * 100), 0) / 100;
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
  const dues = [
    ...bills
      .filter((b) => b.active && !paid.has(b.id))
      .map((b) => ({ key: b.id, name: b.name, due: dateInMonth(month, b.due_day), amount: b.amount })),
    ...billingCards.flatMap((c) => {
      const inv = invoiceFor(month, c.closing_day!, c.due_day!);
      const t = invoiceTotals(cardTxs.filter((x) => x.account_id === c.id), transferIds, inv);
      return t.total > 0 && t.paid < t.total
        ? [{ key: c.id, name: `Fatura ${c.name}`, due: inv.due, amount: Math.round((t.total - t.paid) * 100) / 100 }]
        : [];
    }),
  ].sort((a, b) => a.due.localeCompare(b.due));
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

  return (
    <>
      {/* Saldo das contas: escondido; abre pela setinha da ponta do cabeçalho */}
      <HeroDrawer>
        <div className="pb-6">
          <Card tone="hero">
            <div className="flex items-start justify-between">
              <span className="grid size-12 place-items-center rounded-full border border-white/25">
                <Wallet size={22} aria-hidden />
              </span>
              {cards.length > 0 && <Tag tone="info">{cards.length === 1 ? "1 cartão" : `${cards.length} cartões`}</Tag>}
            </div>
            <p className="mt-4 text-[15px] font-medium">Disponível nas contas</p>
            <p className="mt-1 text-[32px] font-bold tracking-tight tabular-nums">{formatBRL(available)}</p>
            {cards.length > 0 && (
              <p className="mt-1 text-[13px] text-info">
                Cartões: <span className="tabular-nums">{formatBRL(cardDebt)}</span>
              </p>
            )}
          </Card>
        </div>
      </HeroDrawer>

      <div className="flex flex-col gap-6">
        <MonthBalance
          tone="hero"
          result={formatBRL(result)}
          income={formatBRL(income)}
          expense={formatBRL(-expense)}
          caption={monthLabel(month)}
        />

        <div className="flex flex-col gap-3">
          <MonthSwitcher month={month} basePath="/financas" />
          <div className="flex items-center justify-between gap-2">
            <LinkButton href="/financas/importar" variant="ghost">
              <Upload size={16} /> Importar
            </LinkButton>
            <LinkButton href="/financas/lancamentos/novo">
              <Plus size={16} /> Lançar
            </LinkButton>
          </div>
        </div>

        <IncompleteNotice show={transactions.incomplete || cardTxs.incomplete} />

        {slices.length > 0 && (
          <section>
            <BlockTitle action={<SeeAll href={`/financas/orcamento?mes=${month}`}>Ver detalhes</SeeAll>}>Despesas por categoria</BlockTitle>
            <div className="flex items-center gap-5">
              <svg width="104" height="104" viewBox="0 0 42 42" aria-hidden="true" className="shrink-0 -rotate-90">
                <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--surface-2)" strokeWidth="7" />
                {slices.map((sl) => (
                  <circle
                    key={sl.key}
                    cx="21"
                    cy="21"
                    r="15.9"
                    fill="none"
                    stroke={sl.color}
                    strokeWidth="7"
                    strokeDasharray={sl.dash}
                    strokeDashoffset={sl.offset}
                  />
                ))}
              </svg>
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

        {dues.length > 0 && (
          <section>
            <SectionHeader
              title="A pagar neste mês"
              count={dues.length}
              href={`/financas/contas-fixas?mes=${month}`}
              linkLabel="Ver contas"
            />
            <Card className="py-2">
              <ul className="divide-y divide-line">
                {dues.slice(0, 6).map((d) => (
                  <li key={d.key} className="flex items-center gap-3 py-3 text-[15px]">
                    <span className="w-11 shrink-0 text-[13px] tabular-nums text-muted">{shortDate(d.due)}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <StatusBadge status={billStatus(d.due, false, today)} />
                    <span className="font-semibold tabular-nums text-danger">{formatBRL(d.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {budgetTotal > 0 && (
          <Link href={`/financas/orcamento?mes=${month}`} className="block rounded-[20px]">
            <Card className="p-4 transition hover:brightness-105">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">Orçamento</span>
                <span className="tabular-nums">
                  {formatBRL(budgetSpent / 100)} <span className="text-muted">de {formatBRL(budgetTotal / 100)}</span>
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${budgetSpent > budgetTotal ? "bg-danger" : "bg-hero"}`}
                  style={{ width: `${Math.min(budgetSpent / budgetTotal, 1) * 100}%` }}
                />
              </div>
            </Card>
          </Link>
        )}
      </div>
    </>
  );
}
