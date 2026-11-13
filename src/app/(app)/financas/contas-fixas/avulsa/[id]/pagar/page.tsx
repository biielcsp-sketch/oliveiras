import { notFound } from "next/navigation";
import { Card, IncompleteNotice, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getLinkedTransactionIds, getOneOffBill, getTransactionsAround } from "@/lib/financas/planning-data";
import { suggestPayments } from "@/lib/financas/planning";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";
import { PayForm } from "../../../../_components/pay-form";

export const metadata = { title: "Marcar como paga" };

/** Mesmo "Marcar paga" das fixas: lançamentos parecidos do extrato (ainda sem conta) ou paga sem lançamento. */
export default async function PagarAvulsaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ accounts }, oneOff] = await Promise.all([getFinanceBase(), getOneOffBill(id)]);
  if (!oneOff) notFound();
  const month = oneOff.due_date.slice(0, 7);
  const txs = await getTransactionsAround(month, oneOff.account_id ? [oneOff.account_id] : undefined);
  const linked = await getLinkedTransactionIds(txs.filter((t) => t.amount < 0).map((t) => t.id));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const suggestions = suggestPayments(oneOff.amount, oneOff.due_date, txs, linked).map((t) => ({
    ...t,
    accountName: accountName.get(t.account_id) ?? "",
  }));

  return (
    <Card>
      <PageHeader title={`Pagar ${oneOff.name}`} subtitle={`${formatBRL(oneOff.amount)} · vence ${shortDate(oneOff.due_date)} · avulsa`} />
      <IncompleteNotice show={txs.incomplete}>
        Extrato incompleto (lançamentos demais no período ou falha na leitura): pode faltar sugestão de pagamento.
      </IncompleteNotice>
      {oneOff.paid_on ? (
        <p className="text-[15px]">Esta conta já está paga ({shortDate(oneOff.paid_on)}).</p>
      ) : (
        <PayForm oneOffId={oneOff.id} month={month} expected={oneOff.amount} due={oneOff.due_date} suggestions={suggestions} />
      )}
    </Card>
  );
}
