import Link from "next/link";
import { CreditCard, Plus, Search } from "lucide-react";
import { Card, EmptyState, IncompleteNotice, LinkButton } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getBillPayments, getBills, getOneOffBillsForMonth, getOneOffBoletoDocs, getTransactionsAround } from "@/lib/financas/planning-data";
import { billStatus, invoiceFor, invoiceTotals } from "@/lib/financas/planning";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth, shortDate } from "@/lib/financas/period";
import { todaySP } from "@/lib/financas/today";
import { MonthSwitcher } from "../_components/month-switcher";
import { StatusBadge } from "../_components/status-badge";
import { searchStatementPayments, undoPayment } from "../planning-actions";
import { BaixaSuggestion } from "../_components/baixa-suggestion";
import { getAllBaixaSuggestions, getPaymentTransactions } from "@/lib/financas/baixa-data";
import { undoOneOffPayment } from "../avulsas-actions";
import { OneOffSuggestion } from "../_components/oneoff-suggestion";
import { oneOffStatus } from "@/lib/financas/avulsas";
import { oneOffDeletePath, oneOffPath } from "@/lib/financas/routes";
import { DocUpload } from "../_components/doc-upload";
import { countPendingDocuments, getConfirmedBillDocs } from "@/lib/financas/documentos/data";
import { billForMonth } from "@/lib/financas/documentos/rules";

export const metadata = { title: "Contas fixas" };

export default async function ContasFixasPage({ searchParams }: { searchParams: Promise<{ mes?: string; procurado?: string }> }) {
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const searched = sp.procurado !== undefined && /^\d{1,3}$/.test(sp.procurado) ? Number(sp.procurado) : null;
  const today = todaySP();
  const { accounts, categories } = await getFinanceBase();
  const cards = accounts.filter((a) => a.kind === "cartao" && !a.archived && a.closing_day && a.due_day);
  const [bills, payments, cardTxs, billDocs, pendingDocs, allSuggestions, oneOffs] = await Promise.all([
    getBills(),
    getBillPayments(month),
    getTransactionsAround(month, cards.map((c) => c.id)),
    getConfirmedBillDocs(month),
    countPendingDocuments(),
    getAllBaixaSuggestions(month),
    getOneOffBillsForMonth(month),
  ]);
  const suggestions = allSuggestions.fixed;
  const oneOffDocs = await getOneOffBoletoDocs(oneOffs.map((o) => o.id));
  const linkedTxs = await getPaymentTransactions([...new Set([...suggestions, ...allSuggestions.oneOff].map((m) => m.transaction_id))]);
  const oneOffSuggestions = new Map<string, typeof allSuggestions.oneOff>();
  for (const m of allSuggestions.oneOff) oneOffSuggestions.set(m.one_off_bill_id, [...(oneOffSuggestions.get(m.one_off_bill_id) ?? []), m]);
  const totalOneOffs = oneOffs.reduce((s, o) => s + Math.round(o.amount * 100), 0) / 100;
  const suggestionsByBill = new Map<string, typeof suggestions>();
  for (const m of suggestions) suggestionsByBill.set(m.bill_id, [...(suggestionsByBill.get(m.bill_id) ?? []), m]);
  const transferIds = new Set(categories.filter((c) => c.kind === "transferencia").map((c) => c.id));
  const paymentByBill = new Map(payments.map((p) => [p.bill_id, p]));
  const activeBills = bills.filter((b) => b.active || paymentByBill.has(b.id));
  // Boleto confirmado do mês: o valor e o vencimento dele valem para este mês (o valor fixo da conta não muda).
  const expectedOf = (b: (typeof bills)[number]) => billForMonth(b, month, billDocs.get(b.id)).amount;
  const totalBills = activeBills.reduce((s, b) => s + Math.round(expectedOf(b) * 100), 0) / 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} basePath="/financas/contas-fixas" />
        <LinkButton href="/financas/contas-fixas/nova">
          <Plus size={16} /> Nova conta
        </LinkButton>
      </div>

      <IncompleteNotice show={cardTxs.incomplete}>
        Lançamentos dos cartões incompletos (lançamentos demais no período ou falha na leitura): os valores das faturas são parciais.
      </IncompleteNotice>
      <IncompleteNotice show={allSuggestions.incomplete}>
        Sugestões de pagamento indisponíveis: extrato grande demais (ou falha na leitura). Marque as contas pagas à mão.
      </IncompleteNotice>

      {(activeBills.length > 0 || oneOffs.length > 0) && (
        <form action={searchStatementPayments} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="month" value={month} />
          <button className="flex items-center gap-1.5 text-sm font-medium text-link">
            <Search size={15} aria-hidden /> Procurar pagamentos no extrato
          </button>
          {searched !== null && (
            <span role="status" className="text-sm text-muted">
              {searched === 0
                ? "Nenhum pagamento novo encontrado com certeza."
                : `${searched} ${searched === 1 ? "conta paga" : "contas pagas"} pelo extrato.`}
            </span>
          )}
        </form>
      )}

      <DocUpload pending={pendingDocs} />

      {cards.length > 0 && (
        <Card className="py-1">
          <h2 className="pt-3 font-medium">Faturas de cartão</h2>
          <ul className="divide-y divide-line">
            {cards.map((c) => {
              const inv = invoiceFor(month, c.closing_day!, c.due_day!);
              const { total, paid } = invoiceTotals(cardTxs.filter((t) => t.account_id === c.id), transferIds, inv);
              const status = billStatus(inv.due, total <= 0 || paid >= total, today);
              return (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <CreditCard size={18} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="text-[12px] text-muted">
                      Compras de {shortDate(inv.start)} a {shortDate(addDaysLabel(inv.closing))} · vence {shortDate(inv.due)}
                      {paid > 0 && ` · pago ${formatBRL(paid)}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular-nums">{formatBRL(total)}</span>
                    <StatusBadge status={status} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {activeBills.length === 0 ? (
        <EmptyState title="Nenhuma conta fixa cadastrada">Aluguel, luz, água, internet, escola, plano de saúde…</EmptyState>
      ) : (
        <Card className="py-1" role="region" aria-label="Contas do mês">
          <div className="flex items-baseline justify-between pt-3">
            <h2 className="font-medium">Contas do mês</h2>
            <span className="text-sm tabular-nums text-muted">{formatBRL(totalBills)}</span>
          </div>
          <ul className="divide-y divide-line">
            {activeBills.map((b) => {
              const doc = billDocs.get(b.id);
              const due = billForMonth(b, month, doc).due;
              const payment = paymentByBill.get(b.id);
              const status = billStatus(due, Boolean(payment), today);
              const auto = Boolean(payment?.auto);
              const billSuggestions = payment ? [] : (suggestionsByBill.get(b.id) ?? []);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/financas/contas-fixas/${b.id}`} className="block truncate font-medium hover:underline">
                      {b.name}
                    </Link>
                    <p className="text-[12px] text-muted">
                      vence {shortDate(due)}
                      {payment && ` · paga em ${shortDate(payment.paid_on)}${payment.transaction_id && !auto ? " (no extrato)" : ""}`}
                      {payment?.transaction_id && auto && (
                        <>
                          {" · "}
                          <Link href={`/financas/lancamentos/${payment.transaction_id}`} className="font-medium text-link">
                            Baixa automática
                          </Link>
                        </>
                      )}
                      {doc && (
                        <>
                          {" · "}
                          <a href={`/financas/documentos/${doc.id}/arquivo`} target="_blank" rel="noopener" className="font-medium text-link">
                            {doc.file_mime === "application/pdf" ? "boleto (PDF)" : "boleto (foto)"}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular-nums">{formatBRL(payment?.amount ?? expectedOf(b))}</span>
                    {payment ? (
                      <form action={undoPayment} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={payment.id} />
                        <input type="hidden" name="month" value={month} />
                        <StatusBadge status="paga" />
                        <button className="text-[11px] text-muted underline">desfazer</button>
                      </form>
                    ) : (
                      <span className="flex items-center gap-2">
                        <StatusBadge status={status} />
                        <Link
                          href={`/financas/contas-fixas/${b.id}/pagar?mes=${month}`}
                          className="text-[12px] font-medium text-olive"
                        >
                          Marcar paga
                        </Link>
                      </span>
                    )}
                  </div>
                  {billSuggestions.length > 0 && (
                    <div className="basis-full">
                      {billSuggestions.map((m) => {
                        const t = linkedTxs.get(m.transaction_id);
                        return (
                          <BaixaSuggestion
                            key={m.transaction_id}
                            billId={b.id}
                            billName={b.name}
                            month={month}
                            transactionId={m.transaction_id}
                            description={t?.description ?? "Lançamento do extrato"}
                            date={m.paid_on}
                            amount={m.amount}
                          />
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {oneOffs.length > 0 && (
        <Card className="py-1" role="region" aria-label="Contas avulsas">
          <div className="flex items-baseline justify-between pt-3">
            <h2 className="font-medium">Contas avulsas</h2>
            <span className="text-sm tabular-nums text-muted">{formatBRL(totalOneOffs)}</span>
          </div>
          <p className="text-[12px] text-muted">Pagas uma vez só: aparecem no mês do vencimento.</p>
          <ul className="divide-y divide-line">
            {oneOffs.map((o) => {
              const doc = oneOffDocs.get(o.id);
              const status = oneOffStatus(o, today);
              const sugg = o.paid_on ? [] : (oneOffSuggestions.get(o.id) ?? []);
              return (
                <li key={o.id} data-testid="conta-avulsa" aria-label={o.name} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={oneOffPath(o.id)} className="block truncate font-medium hover:underline">
                      {o.name}
                    </Link>
                    <p className="text-[12px] text-muted">
                      vence {shortDate(o.due_date)}
                      {o.paid_on && ` · paga em ${shortDate(o.paid_on)}${o.transaction_id && !o.paid_auto ? " (no extrato)" : ""}`}
                      {o.transaction_id && o.paid_auto && (
                        <>
                          {" · "}
                          <Link href={`/financas/lancamentos/${o.transaction_id}`} className="font-medium text-link">
                            Baixa automática
                          </Link>
                        </>
                      )}
                      {doc && (
                        <>
                          {" · "}
                          <a href={`/financas/documentos/${doc.id}/arquivo`} target="_blank" rel="noopener" className="font-medium text-link">
                            {doc.file_mime === "application/pdf" ? "boleto (PDF)" : "boleto (foto)"}
                          </a>
                        </>
                      )}
                      {" · "}
                      <Link href={oneOffDeletePath(o.id, null, month)} aria-label={`Apagar ${o.name}`} className="font-medium text-danger">
                        Apagar
                      </Link>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular-nums">{formatBRL(o.amount)}</span>
                    {o.paid_on ? (
                      <form action={undoOneOffPayment} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="month" value={month} />
                        <StatusBadge status="paga" />
                        <button className="text-[11px] text-muted underline">desfazer</button>
                      </form>
                    ) : (
                      <span className="flex items-center gap-2">
                        <StatusBadge status={status} />
                        <Link href={`${oneOffPath(o.id)}/pagar`} className="text-[12px] font-medium text-olive">
                          Marcar paga
                        </Link>
                      </span>
                    )}
                  </div>
                  {sugg.length > 0 && (
                    <div className="basis-full">
                      {sugg.map((m) => {
                        const t = linkedTxs.get(m.transaction_id);
                        return (
                          <OneOffSuggestion
                            key={m.transaction_id}
                            oneOffId={o.id}
                            name={o.name}
                            month={month}
                            transactionId={m.transaction_id}
                            description={t?.description ?? "Lançamento do extrato"}
                            date={m.paid_on}
                            amount={m.amount}
                          />
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Último dia de compras da fatura = véspera do fechamento. */
function addDaysLabel(closing: string) {
  const d = new Date(`${closing}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
