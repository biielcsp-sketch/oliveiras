import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getBills, getLinkedTransactionIds, getTransactionsAround } from "@/lib/financas/planning-data";
import { dateInMonth, suggestPayments } from "@/lib/financas/planning";
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
  const [{ accounts }, bills, linked] = await Promise.all([getFinanceBase(), getBills(), getLinkedTransactionIds()]);
  const bill = bills.find((b) => b.id === id);
  if (!bill) notFound();

  const due = dateInMonth(month, bill.due_day);
  const txs = await getTransactionsAround(month, bill.account_id ? [bill.account_id] : undefined);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const suggestions = suggestPayments(bill.amount, due, txs, linked).map((t) => ({
    ...t,
    accountName: accountName.get(t.account_id) ?? "",
  }));

  return (
    <Card>
      <PageHeader title={`Pagar ${bill.name}`} subtitle={`${formatBRL(bill.amount)} · vence ${shortDate(due)}`} />
      <PayForm billId={bill.id} month={month} expected={bill.amount} due={due} suggestions={suggestions} />
    </Card>
  );
}
