import Link from "next/link";
import { CreditCard, Plus } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getBillPayments, getBills, getTransactionsAround } from "@/lib/financas/planning-data";
import { billStatus, invoiceFor, invoiceTotals } from "@/lib/financas/planning";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth, shortDate } from "@/lib/financas/period";
import { todaySP } from "@/lib/financas/today";
import { MonthSwitcher } from "../_components/month-switcher";
import { StatusBadge } from "../_components/status-badge";
import { undoPayment } from "../planning-actions";
import { DocUpload } from "../_components/doc-upload";
import { countPendingDocuments, getConfirmedBillDocs } from "@/lib/financas/documentos/data";
import { billForMonth } from "@/lib/financas/documentos/rules";

export const metadata = { title: "Contas a pagar" };

export default async function ContasAPagarPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const month = parseMonth((await searchParams).mes);
  const today = todaySP();
  const { accounts, categories } = await getFinanceBase();
  const cards = accounts.filter((a) => a.kind === "cartao" && !a.archived && a.closing_day && a.due_day);
  const [bills, payments, cardTxs, billDocs, pendingDocs] = await Promise.all([
    getBills(),
    getBillPayments(month),
    getTransactionsAround(month, cards.map((c) => c.id)),
    getConfirmedBillDocs(month),
    countPendingDocuments(),
  ]);
  const transferIds = new Set(categories.filter((c) => c.kind === "transferencia").map((c) => c.id));
  const paymentByBill = new Map(payments.map((p) => [p.bill_id, p]));
  const activeBills = bills.filter((b) => b.active || paymentByBill.has(b.id));
  // Boleto confirmado do mês: o valor e o vencimento dele valem para este mês (o valor fixo da conta não muda).
  const expectedOf = (b: (typeof bills)[number]) => billForMonth(b, month, billDocs.get(b.id)).amount;
  const totalBills = activeBills.reduce((s, b) => s + Math.round(expectedOf(b) * 100), 0) / 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} basePath="/financas/contas-a-pagar" />
        <LinkButton href="/financas/contas-a-pagar/nova">
          <Plus size={16} /> Nova conta
        </LinkButton>
      </div>

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
        <EmptyState title="Nenhuma conta a pagar cadastrada">Aluguel, luz, água, internet, escola, plano de saúde…</EmptyState>
      ) : (
        <Card className="py-1">
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
              return (
                <li key={b.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/financas/contas-a-pagar/${b.id}`} className="block truncate font-medium hover:underline">
                      {b.name}
                    </Link>
                    <p className="text-[12px] text-muted">
                      vence {shortDate(due)}
                      {payment &&
                        ` · paga em ${shortDate(payment.paid_on)}${payment.transaction_id ? " (no extrato)" : ""}`}
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
                          href={`/financas/contas-a-pagar/${b.id}/pagar?mes=${month}`}
                          className="text-[12px] font-medium text-olive"
                        >
                          Marcar paga
                        </Link>
                      </span>
                    )}
                  </div>
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
