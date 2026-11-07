import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { getFinanceBase, getTransactions } from "@/lib/financas/data";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth } from "@/lib/financas/period";
import { MonthSwitcher } from "./_components/month-switcher";
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
  const { income, expense, result, expenseByCategory } = summarize(transactions, categories, new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id)));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const maxCat = expenseByCategory[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} basePath="/financas" />
        <div className="flex gap-2">
          <LinkButton href="/financas/importar" variant="ghost">
            <Upload size={16} /> Importar
          </LinkButton>
          <LinkButton href="/financas/lancamentos/novo">
            <Plus size={16} /> Lançar
          </LinkButton>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <Card className="col-span-2 p-4">
          <p className="text-[13px] text-muted">Disponível nas contas</p>
          <p className="mt-1 text-[28px] font-semibold tracking-tight tabular-nums">{formatBRL(available)}</p>
          {cards.length > 0 && (
            <p className="mt-1 text-[13px] text-muted">
              Cartões: <span className="tabular-nums">{formatBRL(cardDebt)}</span>
            </p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-[13px] text-muted">Entradas</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-olive">{formatBRL(income)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[13px] text-muted">Saídas</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatBRL(-expense)}</p>
        </Card>
        <Card className="col-span-2 flex items-center justify-between p-4">
          <p className="text-[13px] text-muted">Resultado do mês</p>
          <p className={`text-lg font-semibold tabular-nums ${result >= 0 ? "text-olive" : "text-danger"}`}>
            {formatBRL(result)}
          </p>
        </Card>
      </section>

      {expenseByCategory.length > 0 && (
        <Card>
          <h2 className="font-medium">Gastos por categoria</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {expenseByCategory.slice(0, 8).map(({ category_id, total }) => {
              const cat = category_id ? catById.get(category_id) : undefined;
              return (
                <li key={category_id ?? "sem"}>
                  <Link
                    href={`/financas/lancamentos?mes=${month}&categoria=${category_id ?? "sem"}`}
                    className="block"
                  >
                    <div className="flex justify-between text-sm">
                      <span>{cat?.name ?? "Sem categoria"}</span>
                      <span className="tabular-nums text-muted">{formatBRL(total)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(4, (total / maxCat) * 100)}%`, background: cat?.color ?? "var(--muted)" }}
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Últimos lançamentos</h2>
          <Link href={`/financas/lancamentos?mes=${month}`} className="text-sm text-olive">
            Ver todos
          </Link>
        </div>
        {transactions.length > 0 ? (
          <TxList transactions={transactions.slice(0, 6)} accounts={accounts} categories={categories} />
        ) : (
          <p className="mt-3 text-sm text-muted">Nenhum lançamento neste mês.</p>
        )}
      </Card>
    </div>
  );
}
