import Link from "next/link";
import { ArrowRight, ChevronDown, Plus, Search } from "lucide-react";
import { Badge, Card, chipClass, EmptyState, IncompleteNotice, Input, LinkButton, Select } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { getFinanceBase, getTransferLegs, getTransactions } from "@/lib/financas/data";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth } from "@/lib/financas/period";
import { todaySP } from "@/lib/financas/today";
import { accountLabel } from "@/lib/financas/account-label";
import { parseTipo, splitByTipo, TX_TIPOS } from "@/lib/financas/transfers";
import { buildTransferFeed, groupByDay, MOSTRAR_STEP, parseMostrar, sliceVisible } from "@/lib/financas/lancamentos-view";
import { getTransferReview } from "@/lib/financas/transfers-data";
import { MonthSwitcher } from "../_components/month-switcher";
import { TxList } from "../_components/tx-list";
import { UnlinkButton } from "../_components/transfer-controls";

export const metadata = { title: "Lançamentos" };

type Params = { mes?: string; conta?: string; categoria?: string; q?: string; tipo?: string; aprendeu?: string; mostrar?: string };

export default async function LancamentosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const tipo = parseTipo(sp.tipo);
  const limit = parseMostrar(sp.mostrar);
  const [{ household, members }, { accounts, categories }] = await Promise.all([getAppContext(), getFinanceBase()]);
  const transactions = await getTransactions({
    month,
    account: sp.conta || undefined,
    category: sp.categoria || undefined,
    q: sp.q?.trim() || undefined,
  });
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const nameOf = (id: string) => {
    const a = accountById.get(id);
    return a ? accountLabel(a, memberName) : "—";
  };

  // A outra perna do par pode estar fora do filtro (conta, busca) ou do mês.
  const legs =
    tipo === "gastos" ? [] : await getTransferLegs(transactions.filter((t) => t.transfer_group).map((t) => t.transfer_group!));
  const { rows, pairs } = splitByTipo(tipo, transactions, categories, accounts, legs);
  const pendingReview = tipo === "transferencias" ? (await getTransferReview(await createClient(), household.id)).length : 0;
  // Totais sobre TODAS as linhas do mês (não só as exibidas).
  const { income, expense } = summarize(rows, categories, new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id)));
  const learned = Number(sp.aprendeu);
  const today = todaySP();
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const feed = tipo === "transferencias" ? buildTransferFeed(pairs, rows, categories) : null;
  const { shown, hasMore, total } = feed ? sliceVisible(feed, limit) : sliceVisible(rows, limit);
  const days = groupByDay(shown as { date: string }[], today);

  const keep = { conta: sp.conta, categoria: sp.categoria, q: sp.q, tipo: tipo === "gastos" ? undefined : tipo };
  const hrefWith = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ mes: month });
    for (const [k, v] of Object.entries({ conta: sp.conta, categoria: sp.categoria, q: sp.q, ...extra })) if (v) p.set(k, v);
    return `/financas/lancamentos?${p.toString()}`;
  };
  const tabHref = (t: string) => hrefWith({ tipo: t === "gastos" ? undefined : t });
  const moreHref = hrefWith({ tipo: tipo === "gastos" ? undefined : tipo, mostrar: String(limit + MOSTRAR_STEP) });
  const activeFilters = (sp.conta ? 1 : 0) + (sp.categoria ? 1 : 0);
  const conferirHref = `/financas/lancamentos/conferir?mes=${month}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-3">
        <MonthSwitcher month={month} basePath="/financas/lancamentos" params={keep} />
        <LinkButton href="/financas/lancamentos/novo" size="sm">
          <Plus size={15} aria-hidden /> Lançar
        </LinkButton>
      </div>

      {Number.isInteger(learned) && learned > 0 && (
        <p role="status" className="rounded-2xl bg-success-soft px-4 py-3 text-sm text-success">
          {learned === 1 ? "1 lançamento parecido também foi categorizado." : `${learned} lançamentos parecidos também foram categorizados.`}
        </p>
      )}

      <nav aria-label="Tipo de lançamento" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TX_TIPOS.map((t) => (
          <Link key={t.value} href={tabHref(t.value)} aria-current={tipo === t.value ? "page" : undefined} className={chipClass(tipo === t.value)}>
            {t.label}
          </Link>
        ))}
      </nav>

      <form className="flex flex-col gap-3" role="search">
        <input type="hidden" name="mes" value={month} />
        {tipo !== "gastos" && <input type="hidden" name="tipo" value={tipo} />}
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Buscar</span>
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <Input name="q" defaultValue={sp.q} placeholder="Buscar descrição" className="pl-11" />
          </label>
        </div>
        <details className="group glass-card rounded-[20px]" open={activeFilters > 0}>
          <summary className="flex h-12 cursor-pointer list-none items-center justify-between gap-2 px-5 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              Filtros
              {activeFilters > 0 && (
                <span aria-label={`${activeFilters} filtros ativos`} className="rounded-full bg-badge px-2 py-0.5 text-[12px] font-semibold leading-none tabular-nums text-on-badge">
                  {activeFilters}
                </span>
              )}
            </span>
            <ChevronDown size={16} aria-hidden className="transition group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <Select name="conta" defaultValue={sp.conta ?? ""} aria-label="Conta">
              <option value="">Todas as contas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a, memberName)}</option>
              ))}
            </Select>
            <Select name="categoria" defaultValue={sp.categoria ?? ""} aria-label="Categoria">
              <option value="">Todas as categorias</option>
              <option value="sem">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <div className="flex items-center gap-3">
              <button className="h-12 rounded-full border border-line bg-surface-solid px-5 text-[15px] font-medium shadow-soft hover:bg-surface-2">Filtrar</button>
              {activeFilters > 0 && (
                <Link href={hrefWith({ conta: undefined, categoria: undefined, tipo: tipo === "gastos" ? undefined : tipo })} className="text-sm font-medium text-primary">
                  Limpar filtros
                </Link>
              )}
            </div>
          </div>
        </details>
      </form>

      <IncompleteNotice show={transactions.incomplete} />

      {tipo === "gastos" && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">{rows.length} lançamentos</span>
          <span className="rounded-full bg-success-soft px-3 py-1.5 font-semibold text-success">
            Entradas <span className="tabular-nums">{formatBRL(income)}</span>
          </span>
          <span className="rounded-full bg-danger-soft px-3 py-1.5 font-semibold text-danger">
            Saídas <span className="tabular-nums">{formatBRL(-expense)}</span>
          </span>
        </div>
      )}

      {tipo === "transferencias" && pendingReview > 0 && (
        <div>
          <LinkButton href={conferirHref} variant="ghost" size="sm">
            Conferir transferências
            <span className="rounded-full bg-badge px-2 py-0.5 text-[12px] font-semibold leading-none tabular-nums text-on-badge">{pendingReview}</span>
          </LinkButton>
        </div>
      )}

      {days.length > 0 ? (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <section key={day.date} className="flex flex-col gap-1.5" aria-label={day.label}>
              <h2 className="px-1 text-[13px] font-semibold text-muted">{day.label}</h2>
              <Card className="py-1">
                {feed ? (
                  <ul className="divide-y divide-line" aria-label="Transferências entre contas">
                    {(day.items as typeof feed).map((it) =>
                      it.type === "pair" ? (
                        <li key={it.key} className="flex items-center gap-3 py-2.5">
                          <Link href={`/financas/lancamentos/${it.pair.out.id}`} className="-mx-2 flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-2 py-1 hover:bg-accent-soft/60">
                            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                              {nameOf(it.pair.out.account_id)} <ArrowRight size={13} className="inline" aria-label="para" /> {nameOf(it.pair.in.account_id)}
                            </span>
                            {it.fatura && <Badge tone="neutral" className="shrink-0">Fatura</Badge>}
                            <span className="shrink-0 text-[14px] font-bold tabular-nums text-muted">{formatBRL(it.pair.amount)}</span>
                          </Link>
                          <UnlinkButton group={it.pair.group} />
                        </li>
                      ) : (
                        <li key={it.key}>
                          <TxList
                            transactions={[it.tx]}
                            accounts={accounts}
                            categories={categories}
                            members={members}
                            showDate={false}
                            badgeFor={(t) => (catName.get(t.category_id ?? "") === "Pagamento Cartão de Crédito" ? "Fatura" : undefined)}
                          />
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <TxList transactions={day.items as typeof rows} accounts={accounts} categories={categories} members={members} showDate={false} />
                )}
              </Card>
            </section>
          ))}
          <div className="flex flex-col items-center gap-2">
            <p className="text-[13px] text-muted">Mostrando {shown.length} de {total}</p>
            {hasMore && (
              <LinkButton href={moreHref} variant="ghost" size="sm">
                Mostrar mais {MOSTRAR_STEP}
              </LinkButton>
            )}
          </div>
        </div>
      ) : (
        <EmptyState title="Nenhum lançamento encontrado">
          {tipo === "gastos" ? "Mude o mês ou os filtros, ou importe um extrato." : "Nada neste mês. Sincronize ou importe e confira as transferências."}
        </EmptyState>
      )}
    </div>
  );
}
