import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { getFinanceBase } from "@/lib/financas/data";
import { TxForm } from "../../_components/tx-form";
import { todaySP } from "@/lib/financas/today";

export const metadata = { title: "Novo lançamento" };

export default async function NovoLancamentoPage() {
  const [{ members, me }, { accounts, categories }] = await Promise.all([getAppContext(), getFinanceBase()]);
  if (accounts.length === 0) redirect("/financas/contas/nova");
  return (
    <Card>
      <PageHeader title="Novo lançamento" />
      <TxForm accounts={accounts} categories={categories} members={members} defaultMemberId={me?.id ?? null} today={todaySP()} />
    </Card>
  );
}
