import Link from "next/link";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, SectionHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { getFinanceBase, getTransferLegs, getTransactions } from "@/lib/financas/data";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth, shortDate } from "@/lib/financas/period";
import { accountLabel } from "@/lib/financas/account-label";
import { splitByTipo } from "@/lib/financas/transfers";
import { getTransferReview } from "@/lib/financas/transfers-data";
import { FindPairsButton, ReviewButtons, UnlinkButton } from "../../_components/transfer-controls";

export const metadata = { title: "Conferir transferências" };

export default async function ConferirTransferenciasPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const [{ household, members }, { accounts, categories }] = await Promise.all([getAppContext(), getFinanceBase()]);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const nameOf = (id: string) => {
    const a = accountById.get(id);
    return a ? accountLabel(a, memberName) : "—";
  };

  const [review, transactions] = await Promise.all([
    getTransferReview(await createClient(), household.id),
    getTransactions({ month }),
  ]);
  const legs = await getTransferLegs(transactions.filter((t) => t.transfer_group).map((t) => t.transfer_group!));
  const { pairs } = splitByTipo("transferencias", transactions, categories, accounts, legs);
  const back = `/financas/lancamentos?mes=${month}&tipo=transferencias`;

  return (
    <div className="flex flex-col gap-5">
      <Link href={back} className="inline-flex items-center gap-1 text-sm font-medium text-primary">
        <ChevronLeft size={16} aria-hidden /> Transferências
      </Link>
      <PageHeader title="Conferir transferências" />
      <FindPairsButton />

      <section className="flex flex-col gap-2" aria-label="Conferir">
        <SectionHeader title="Para conferir" count={review.length} />
        {review.length > 0 ? (
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
        ) : (
          <EmptyState title="Nada para conferir">Toque em “Procurar pares” depois de sincronizar ou importar.</EmptyState>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Já conferidos">
        <SectionHeader title="Já conferidos" />
        {pairs.length > 0 ? (
          <Card className="py-1">
            <ul className="divide-y divide-line" aria-label="Transferências entre contas">
              {pairs.map((p) => (
                <li key={p.group} className="flex items-center gap-3 py-2.5">
                  <Link href={`/financas/lancamentos/${p.out.id}`} className="-mx-2 flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-2 py-1 hover:bg-accent-soft/60">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                      {nameOf(p.out.account_id)} <ArrowRight size={13} className="inline" aria-label="para" /> {nameOf(p.in.account_id)}
                    </span>
                    {p.kind === "cartao" && <Badge tone="neutral" className="shrink-0">Fatura</Badge>}
                    <span className="shrink-0 text-[14px] font-bold tabular-nums text-muted">{formatBRL(p.amount)}</span>
                    <span className="w-11 shrink-0 text-right text-[13px] tabular-nums text-muted">{shortDate(p.date)}</span>
                  </Link>
                  <UnlinkButton group={p.group} />
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-sm text-muted">Nenhum par neste mês.</p>
        )}
      </section>
    </div>
  );
}
