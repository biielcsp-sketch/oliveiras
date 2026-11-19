import Link from "next/link";
import { ChevronDown, FolderCog, Inbox, ListChecks, Target } from "lucide-react";
import { Card, IncompleteNotice, SectionHeader } from "@/components/ui";
import { getFinanceBase, getTransactions } from "@/lib/financas/data";
import { getBudgetRows } from "@/lib/financas/planning-data";
import { resolveBudgets } from "@/lib/financas/planning";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth } from "@/lib/financas/period";
import { abbreviateBRL, budgetBlocks, spendSegments } from "@/lib/financas/budget-view";
import { MonthSwitcher } from "../_components/month-switcher";
import { BudgetRow } from "../_components/budget-row";

export const metadata = { title: "Orçamento" };

const VISIBLE = 6;

/** Anel de progresso (circunferência 100): fração gasta do orçado, limitada a 100% no desenho. */
function ProgressRing({ ratio }: { ratio: number }) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100;
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 42 42" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="4" />
        <circle
          cx="21"
          cy="21"
          r="15.9155"
          fill="none"
          stroke="#ffffff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${pct} ${100 - pct}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-xl font-bold tabular-nums leading-none">{Math.round(ratio * 100)}%</p>
          <p className="mt-0.5 text-[10.5px] opacity-85">do orçado</p>
        </div>
      </div>
    </div>
  );
}

export default async function OrcamentoPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const month = parseMonth((await searchParams).mes);
  const [{ accounts, categories }, transactions, rows] = await Promise.all([
    getFinanceBase(),
    getTransactions({ month }),
    getBudgetRows(),
  ]);
  const cards = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const { expense, expenseByCategory } = summarize(transactions, categories, cards);
  const spentBy = new Map(expenseByCategory.map((e) => [e.category_id, e.total]));
  const budgets = resolveBudgets(rows, month);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const expenseCats = categories.filter((c) => c.kind === "despesa");
  const withBudget = expenseCats.filter((c) => (budgets.get(c.id)?.amount ?? 0) > 0);
  const totalBudget = withBudget.reduce((s, c) => s + Math.round((budgets.get(c.id)?.amount ?? 0) * 100), 0) / 100;
  const totalSpent = withBudget.reduce((s, c) => s + Math.round((spentBy.get(c.id) ?? 0) * 100), 0) / 100;
  const ratio = totalBudget > 0 ? totalSpent / totalBudget : 0;
  const left = Math.round((totalBudget - totalSpent) * 100) / 100;

  const blocks = budgetBlocks(expenseCats, budgets, spentBy);
  const shown = blocks.slice(0, VISIBLE);
  const rest = blocks.slice(VISIBLE);

  const segments = spendSegments(expenseByCategory, (id) => (id ? catName.get(id) ?? "Sem categoria" : "Sem categoria"));
  // Mesma regra do Resumo: reaproveita summarize() lançamento a lançamento para contar só o que entra na despesa.
  const isExpense = (t: (typeof transactions)[number]) => summarize([t], categories, cards).expense > 0;
  const expenseTxs = transactions.filter(isExpense);
  const uncategorized = expenseTxs.filter((t) => !t.category_id);
  const uncategorizedTotal = spentBy.get(null) ?? 0;

  const lancamentos = `/financas/lancamentos?mes=${month}`;
  const actions = [
    { href: "#categorias", label: "Definir", icon: Target },
    { href: "/financas/categorias", label: "Categorias", icon: FolderCog },
    { href: `${lancamentos}&categoria=sem`, label: "Sem categoria", icon: Inbox },
    { href: lancamentos, label: "Lançamentos", icon: ListChecks },
  ];

  const renderBlock = (b: (typeof blocks)[number]) => (
    <BudgetRow
      key={b.categoryId}
      categoryId={b.categoryId}
      name={b.name}
      color={b.color}
      month={month}
      spent={b.spent}
      budget={b.amount === null ? undefined : { amount: b.amount, override: b.override }}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <MonthSwitcher month={month} basePath="/financas/orcamento" />
      <IncompleteNotice show={transactions.incomplete} />

      <Card tone="hero" className="p-5">
        {totalBudget > 0 ? (
          <div className="flex items-center gap-5">
            <ProgressRing ratio={ratio} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] opacity-85">Gasto com orçamento</p>
              <p className="text-2xl font-bold tabular-nums">{formatBRL(totalSpent)}</p>
              <p className="text-[13px] opacity-85 tabular-nums">de {formatBRL(totalBudget)} orçado</p>
              <p className="mt-2 text-[14px] font-semibold tabular-nums">
                {left >= 0 ? `Restam ${formatBRL(left)}` : `Passou ${formatBRL(-left)}`}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[15px] font-semibold">Nenhuma meta definida neste mês</p>
            <p className="mt-1 text-[13px] opacity-85">Toque em uma categoria abaixo para definir quanto pode gastar.</p>
          </div>
        )}
      </Card>

      <nav aria-label="Atalhos do orçamento" className="grid grid-cols-4 gap-2">
        {actions.map(({ href, label, icon: Icon }) => (
          <Link key={label} href={href} className="group flex min-w-0 flex-col items-center gap-1.5 py-1 text-center">
            <span className="glass-card grid size-12 place-items-center rounded-full text-primary transition group-active:scale-95">
              <Icon size={20} strokeWidth={2.2} aria-hidden />
            </span>
            <span className="w-full text-[11.5px] font-medium leading-tight text-muted">{label}</span>
          </Link>
        ))}
      </nav>

      {segments.length > 0 && (
        <section>
          <SectionHeader title="Seus gastos do mês" />
          <Card className="p-4">
            <div className="flex flex-col items-center gap-4">
              <div className="relative size-44">
                <svg viewBox="0 0 42 42" className="size-full -rotate-90" aria-hidden="true">
                  <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--surface-2)" strokeWidth="6" />
                  {segments.map((s) => (
                    <circle
                      key={s.key}
                      cx="21"
                      cy="21"
                      r="15.9155"
                      fill="none"
                      stroke={s.color}
                      strokeWidth="6"
                      strokeDasharray={`${s.length} ${100 - s.length}`}
                      strokeDashoffset={s.offset - s.gap / 2}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-xl font-bold tabular-nums">{abbreviateBRL(expense)}</p>
                    <p className="text-[11.5px] text-muted">
                      {expenseTxs.length} {expenseTxs.length === 1 ? "lançamento" : "lançamentos"}
                    </p>
                  </div>
                </div>
              </div>
              <ul className="flex flex-wrap justify-center gap-2">
                {segments.map((s) => (
                  <li
                    key={s.key}
                    className="flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]"
                    style={{ borderColor: s.color }}
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{s.label}</span>
                    <span className="sr-only">{formatBRL(s.total)}, </span>
                    <span className="font-bold tabular-nums">{Math.round((s.arc))}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </section>
      )}

      <section id="categorias" className="scroll-mt-4">
        <SectionHeader title="Categorias" />
        <p className="mb-2 text-[13px] text-muted">Toque numa categoria para definir o valor.</p>
        {blocks.length > 0 ? (
          <>
            <ul className="grid grid-cols-2 gap-3">{shown.map(renderBlock)}</ul>
            {rest.length > 0 && (
              <details className="group mt-3">
                <summary className="glass-card mx-auto flex h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-5 text-[14px] font-semibold text-primary [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Ver mais {rest.length}</span>
                  <span className="hidden group-open:inline">Ver menos</span>
                  <ChevronDown size={16} className="transition group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="mt-3 grid grid-cols-2 gap-3">{rest.map(renderBlock)}</ul>
              </details>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Nenhuma categoria de despesa com gasto neste mês.</p>
        )}
      </section>

      {uncategorized.length > 0 && (
        <p className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-[13.5px]">
          <span className="min-w-0 tabular-nums">
            {formatBRL(uncategorizedTotal)} sem categoria · {uncategorized.length}{" "}
            {uncategorized.length === 1 ? "lançamento" : "lançamentos"}
          </span>
          <Link href={`${lancamentos}&categoria=sem`} className="shrink-0 font-semibold text-primary">
            Revisar
          </Link>
        </p>
      )}
    </div>
  );
}
