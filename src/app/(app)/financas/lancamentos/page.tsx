import { Plus, Search } from "lucide-react";
import { Card, EmptyState, Input, LinkButton, Select } from "@/components/ui";
import { getFinanceBase, getTransactions } from "@/lib/financas/data";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth } from "@/lib/financas/period";
import { MonthSwitcher } from "../_components/month-switcher";
import { TxList } from "../_components/tx-list";

export const metadata = { title: "Lançamentos" };

type Params = { mes?: string; conta?: string; categoria?: string; q?: string };

export default async function LancamentosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const { accounts, categories } = await getFinanceBase();
  const transactions = await getTransactions({
    month,
    account: sp.conta || undefined,
    category: sp.categoria || undefined,
    q: sp.q?.trim() || undefined,
  });
  const { income, expense } = summarize(transactions, categories);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} basePath="/financas/lancamentos" params={{ conta: sp.conta, categoria: sp.categoria, q: sp.q }} />
        <LinkButton href="/financas/lancamentos/novo">
          <Plus size={16} /> Lançar
        </LinkButton>
      </div>

      <form className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <input type="hidden" name="mes" value={month} />
        <label className="relative">
          <span className="sr-only">Buscar</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input name="q" defaultValue={sp.q} placeholder="Buscar descrição" className="pl-9" />
        </label>
        <Select name="conta" defaultValue={sp.conta ?? ""} aria-label="Conta" className="sm:w-40">
          <option value="">Todas as contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
        <Select name="categoria" defaultValue={sp.categoria ?? ""} aria-label="Categoria" className="sm:w-44">
          <option value="">Todas as categorias</option>
          <option value="sem">Sem categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <button className="h-11 rounded-xl border border-line bg-surface px-4 text-sm hover:bg-surface-2">Filtrar</button>
      </form>

      <p className="text-sm text-muted">
        {transactions.length} lançamentos · entradas <span className="tabular-nums text-olive">{formatBRL(income)}</span> ·
        saídas <span className="tabular-nums">{formatBRL(-expense)}</span>
      </p>

      {transactions.length > 0 ? (
        <Card className="py-1">
          <TxList transactions={transactions} accounts={accounts} categories={categories} />
        </Card>
      ) : (
        <EmptyState title="Nenhum lançamento encontrado">Mude o mês ou os filtros, ou importe um extrato.</EmptyState>
      )}
    </div>
  );
}
