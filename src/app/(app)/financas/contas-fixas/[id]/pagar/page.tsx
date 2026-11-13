import { notFound } from "next/navigation";
import { Card, IncompleteNotice, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getBills, getLinkedTransactionIds, getTransactionsAround } from "@/lib/financas/planning-data";
import { suggestPayments } from "@/lib/financas/planning";
import { getConfirmedBillDocs } from "@/lib/financas/documentos/data";
import { billForMonth } from "@/lib/financas/documentos/rules";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth, shortDate } from "@/lib/financas/period";
import { PayForm } from "../../../_components/pay-form";

export const metadata = { title: "Marcar como paga" };

export default async function PagarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string }>;
}) {
  const { id } = await params;
  const month = parseMonth((await searchParams).mes);
  const [{ accounts }, bills, billDocs] = await Promise.all([getFinanceBase(), getBills(), getConfirmedBillDocs(month)]);
  const bill = bills.find((b) => b.id === id);
  if (!bill) notFound();

  // Boleto confirmado do mês: valor e vencimento dele; senão, o valor fixo da conta.
  const { amount: expected, due } = billForMonth(bill, month, billDocs.get(bill.id));
  const txs = await getTransactionsAround(month, bill.account_id ? [bill.account_id] : undefined);
  const linked = await getLinkedTransactionIds(txs.filter((t) => t.amount < 0).map((t) => t.id));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const suggestions = suggestPayments(expected, due, txs, linked).map((t) => ({
    ...t,
    accountName: accountName.get(t.account_id) ?? "",
  }));

  return (
    <Card>
      <PageHeader title={`Pagar ${bill.name}`} subtitle={`${formatBRL(expected)} · vence ${shortDate(due)}`} />
      <IncompleteNotice show={txs.incomplete}>
        Extrato incompleto (lançamentos demais no período ou falha na leitura): pode faltar sugestão de pagamento.
      </IncompleteNotice>
      <PayForm billId={bill.id} month={month} expected={expected} due={due} suggestions={suggestions} />
    </Card>
  );
}
