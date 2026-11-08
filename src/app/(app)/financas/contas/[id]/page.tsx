import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { getFinanceBase } from "@/lib/financas/data";
import { formatBRL } from "@/lib/financas/money";
import { AccountForm } from "../../_components/account-form";
import { Button } from "@/components/ui";
import { matchBankBalance } from "../../open-finance-actions";

export const metadata = { title: "Editar conta" };

export default async function EditarContaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ members }, { accounts }] = await Promise.all([getAppContext(), getFinanceBase()]);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();
  const differs = account.bank_balance !== null && Math.round(account.bank_balance * 100) !== Math.round(account.balance * 100);
  return (
    <div className="flex flex-col gap-4">
      {differs && (
        <Card className="flex flex-col gap-3">
          <p className="text-sm">
            O banco informa <strong>{formatBRL(account.bank_balance!)}</strong>, e o app calcula{" "}
            <strong>{formatBRL(account.balance)}</strong>. A diferença costuma ser o saldo inicial ou lançamentos de antes da
            sincronização.
          </p>
          <form action={matchBankBalance}>
            <input type="hidden" name="id" value={account.id} />
            <Button variant="ghost" className="w-full">Ajustar saldo inicial para bater com o banco</Button>
          </form>
        </Card>
      )}
      <Card>
        <PageHeader title={account.name} subtitle={`Saldo atual: ${formatBRL(account.balance)}`} />
        <AccountForm account={account} members={members} />
      </Card>
    </div>
  );
}
