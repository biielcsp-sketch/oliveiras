import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { getFinanceBase } from "@/lib/financas/data";
import { formatBRL } from "@/lib/financas/money";
import { AccountForm } from "../../_components/account-form";

export const metadata = { title: "Editar conta" };

export default async function EditarContaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ members }, { accounts }] = await Promise.all([getAppContext(), getFinanceBase()]);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();
  return (
    <Card>
      <PageHeader title={account.name} subtitle={`Saldo atual: ${formatBRL(account.balance)}`} />
      <AccountForm account={account} members={members} />
    </Card>
  );
}
