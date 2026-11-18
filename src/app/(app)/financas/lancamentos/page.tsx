import Link from "next/link";
import { ArrowRight, Plus, Search } from "lucide-react";
import { Card, chipClass, EmptyState, IncompleteNotice, Input, LinkButton, SectionHeader, Select } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { getFinanceBase, getTransferLegs, getTransactions } from "@/lib/financas/data";
import { summarize } from "@/lib/financas/summary";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth, shortDate } from "@/lib/financas/period";
import { accountLabel } from "@/lib/financas/account-label";
import { parseTipo, splitByTipo, TX_TIPOS } from "@/lib/financas/transfers";
import { getTransferReview } from "@/lib/financas/transfers-data";
import { MonthSwitcher } from "../_components/month-switcher";
import { TxList } from "../_components/tx-list";
import { DocUpload } from "../_components/doc-upload";
import { FindPairsButton, ReviewButtons, UnlinkButton } from "../_components/transfer-controls";
import { countPendingDocuments } from "@/lib/financas/documentos/data";

export const metadata = { title: "Lançamentos" };

type Params = { mes?: string; conta?: string; categoria?: string; q?: string; tipo?: string; aprendeu?: string };

export default async function LancamentosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const tipo = parseTipo(sp.tipo);
  const [{ household, members }, { accounts, categories }] = await Promise.all([getAppContext(), getFinanceBase()]);
  const transactions = await getTransactions({
    month,
    account: sp.conta || undefined,
    category: sp.categoria || undefined,
    q: sp.q?.trim() || undefined,
  });
  const pendingDocs = tipo === "gastos" ? await countPendingDocuments() : 0;
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
  const review = tipo === "transferencias" ? await getTransferReview(await createClient(), household.id) : [];
  const { income, expense } = summarize(rows, categories, new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id)));
  const learned = Number(sp.aprendeu);
  const keep = { conta: sp.conta, categoria: sp.categoria, q: sp.q, tipo: tipo === "gastos" ? undefined : tipo };
  const tabHref = (t: string) => {
    const p = new URLSearchParams({ mes: month });
    for (const [k, v] of Object.entries({ conta: sp.conta, categoria: sp.categoria, q: sp.q })) if (v) p.set(k, v);
    if (t !== "gastos") p.set("tipo", t);
    return `/financas/lancamentos?${p.toString()}`;
  };

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

      {tipo === "gastos" && <DocUpload pending={pendingDocs} />}

      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <input type="hidden" name="mes" value={month} />
        {tipo !== "gastos" && <input type="hidden" name="tipo" value={tipo} />}
        <label className="relative">
          <span className="sr-only">Buscar</span>
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <Input name="q" defaultValue={sp.q} placeholder="Buscar descrição" className="pl-11" />
        </label>
        <Select name="conta" defaultValue={sp.conta ?? ""} aria-label="Conta" className="sm:w-44">
          <option value="">Todas as contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{accountLabel(a, memberName)}</option>
          ))}
        </Select>
        <Select name="categoria" defaultValue={sp.categoria ?? ""} aria-label="Categoria" className="sm:w-44">
          <option value="">Todas as categorias</option>
          <option value="sem">Sem categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <button className="h-12 rounded-full border border-line bg-surface-solid px-5 text-[15px] font-medium shadow-soft hover:bg-surface-2">Filtrar</button>
      </form>

      <IncompleteNotice show={transactions.incomplete} />

      {tipo === "gastos" && (
        <p className="text-sm text-muted">
          {rows.length} lançamentos · entradas <span className="tabular-nums text-success">{formatBRL(income)}</span> ·
          saídas <span className="tabular-nums">{formatBRL(-expense)}</span>
        </p>
      )}

      {tipo === "transferencias" && (
        <>
          <FindPairsButton />
          {review.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Conferir">
              <SectionHeader title="Conferir" />
              <Card className="py-1">
                <ul className="divide-y divide-line">
                  {review.map((r) => (
                    <li key={`${r.outId}-${r.inId}`} className="flex flex-col gap-2 py-3">
                      <p className="text-[14px] font-semibold">
                        {nameOf(r.out.account_id)} → {nameOf(r.in.account_id)} · <span className="tabular-nums">{formatBRL(r.in.amount)}</span>
                      </p>
                      <p className="text-[12.5px] text-muted">
                        {shortDate(r.out.date)} {r.out.description} · {shortDate(r.in.date)} {r.in.description}
                        {r.reason === "ambiguo" ? " · há outro lançamento com o mesmo valor" : " · uma das partes tem categoria escolhida à mão"}
                      </p>
                      <ReviewButtons outId={r.outId} inId={r.inId} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}

      {pairs.length > 0 && (
        <Card className="py-1">
          <ul className="divide-y divide-line" aria-label={tipo === "cartao" ? "Pagamentos de cartão" : "Transferências entre contas"}>
            {pairs.map((p) => (
              <li key={p.group} className="flex items-center gap-3 py-2.5">
                <Link href={`/financas/lancamentos/${p.out.id}`} className="-mx-2 flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-2 py-1 hover:bg-accent-soft/60">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {nameOf(p.out.account_id)} <ArrowRight size={13} className="inline" aria-label="para" /> {nameOf(p.in.account_id)}
                  </span>
                  <span className="shrink-0 text-[14px] font-bold tabular-nums text-muted">{formatBRL(p.amount)}</span>
                  <span className="w-11 shrink-0 text-right text-[13px] tabular-nums text-muted">{shortDate(p.date)}</span>
                </Link>
                <UnlinkButton group={p.group} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.length > 0 ? (
        <Card className="py-1">
          <TxList transactions={rows} accounts={accounts} categories={categories} members={members} />
        </Card>
      ) : (
        pairs.length === 0 && (
          <EmptyState title="Nenhum lançamento encontrado">
            {tipo === "gastos" ? "Mude o mês ou os filtros, ou importe um extrato." : "Nada neste mês. Toque em “Procurar pares” depois de sincronizar ou importar."}
          </EmptyState>
        )
      )}
    </div>
  );
}
