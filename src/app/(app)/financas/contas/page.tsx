import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { ACCOUNT_KIND_LABEL, getFinanceBase } from "@/lib/financas/data";
import { accountInitial, accountTotals, debtOf, limitAvailable, limitUsedPercent, logoColor, splitAccounts } from "@/lib/financas/contas-view";
import { formatBRL } from "@/lib/financas/money";

export const metadata = { title: "Contas" };

export default async function ContasPage() {
  const [{ members }, { accounts }] = await Promise.all([getAppContext(), getFinanceBase()]);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const { banks, cards } = splitAccounts(accounts);
  const totals = accountTotals(accounts);
  const owner = (id: string | null) => (id ? memberName.get(id) : "Conjunta");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3.5">
          <p className="text-[12.5px] text-muted">Disponível nas contas</p>
          <p className={`mt-0.5 truncate text-[18px] font-semibold tabular-nums ${totals.available < 0 ? "text-danger" : ""}`} data-testid="total-disponivel">
            {formatBRL(totals.available)}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[12.5px] text-muted">Faturas dos cartões</p>
          <p className="mt-0.5 truncate text-[18px] font-semibold tabular-nums" data-testid="total-faturas">
            {formatBRL(totals.cardDebt)}
          </p>
        </Card>
      </div>

      <section aria-labelledby="sec-contas">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="sec-contas" className="text-[16px] font-semibold tracking-tight">Contas</h2>
          <LinkButton href="/financas/contas/nova?tipo=conta" size="sm" aria-label="Nova conta">
            <Plus size={15} aria-hidden /> Conta
          </LinkButton>
        </div>
        {banks.length === 0 ? (
          <EmptyState title="Nenhuma conta ainda">Cadastre contas correntes, poupanças, dinheiro e investimentos.</EmptyState>
        ) : (
          <Card className="py-1">
            <ul className="divide-y divide-line">
              {banks.map((a) => (
                <li key={a.id}>
                  <Link href={`/financas/contas/${a.id}`} className={`flex items-center gap-3 py-3 ${a.archived ? "opacity-50" : ""}`}>
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white"
                      style={{ backgroundColor: logoColor(a.institution || a.name) }}
                    >
                      {accountInitial(a)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.name}</p>
                      <p className="truncate text-[13px] text-muted">
                        {ACCOUNT_KIND_LABEL[a.kind]}
                        {a.institution && ` · ${a.institution}`}
                        {` · ${owner(a.owner_member_id)}`}
                        {a.archived && " · arquivada"}
                        {a.external_id && " · Open Finance"}
                      </p>
                      {a.bank_balance !== null && Math.round(a.bank_balance * 100) !== Math.round(a.balance * 100) && (
                        <p className="text-[12px] text-danger">Banco informa {formatBRL(a.bank_balance)}</p>
                      )}
                    </div>
                    <span className={`tabular-nums ${a.balance < 0 ? "text-danger" : ""}`}>{formatBRL(a.balance)}</span>
                    <ChevronRight size={16} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="sec-cartoes">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="sec-cartoes" className="text-[16px] font-semibold tracking-tight">Cartões de crédito</h2>
          <LinkButton href="/financas/contas/nova?tipo=cartao" size="sm" aria-label="Novo cartão">
            <Plus size={15} aria-hidden /> Cartão
          </LinkButton>
        </div>
        {cards.length === 0 ? (
          <EmptyState title="Nenhum cartão ainda">Cadastre um cartão para acompanhar fatura e limite.</EmptyState>
        ) : (
          <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
            {cards.map((a) => {
              const debt = debtOf(a.balance);
              const pct = limitUsedPercent(debt, a.credit_limit);
              return (
                <li key={a.id} className="w-[78%] max-w-[300px] shrink-0 snap-start">
                  <Link href={`/financas/contas/${a.id}`} className={`block ${a.archived ? "opacity-50" : ""}`}>
                    <Card className="p-4">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
                          style={{ backgroundColor: logoColor(a.institution || a.name) }}
                        >
                          {accountInitial(a)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{a.name}</p>
                          <p className="truncate text-[12px] text-muted">
                            {a.institution ? `${a.institution} · ` : ""}
                            {owner(a.owner_member_id)}
                            {a.archived && " · arquivado"}
                            {a.external_id && " · Open Finance"}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 text-[12.5px] text-muted">Fatura atual</p>
                      <p className="text-[20px] font-semibold tabular-nums">{formatBRL(debt)}</p>
                      {a.credit_limit !== null && (
                        <>
                          <div
                            role="progressbar"
                            aria-label="Limite usado"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={pct}
                            className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
                          >
                            <div className={`h-full rounded-full ${pct >= 90 ? "bg-danger" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className="mt-1 text-[12px] text-muted tabular-nums">
                            {formatBRL(debt)} de {formatBRL(a.credit_limit)}
                          </p>
                          <p className="mt-1 text-[12.5px] text-muted">
                            Limite disponível <span className="tabular-nums">{formatBRL(limitAvailable(debt, a.credit_limit))}</span>
                          </p>
                        </>
                      )}
                      {a.balance > 0 && (
                        <p className="mt-1 text-[12.5px] text-success">
                          Crédito na fatura <span className="tabular-nums">{formatBRL(a.balance)}</span>
                        </p>
                      )}
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
