import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { kindFromTipo } from "@/lib/financas/contas-view";
import { AccountForm } from "../../_components/account-form";

export const metadata = { title: "Nova conta" };

export default async function NovaContaPage({ searchParams }: { searchParams: Promise<{ tipo?: string | string[] }> }) {
  const initialKind = kindFromTipo((await searchParams).tipo);
  const { members } = await getAppContext();
  return (
    <Card>
      <PageHeader title="Nova conta" subtitle="Conta, poupança, cartão, dinheiro ou investimento" />
      <AccountForm members={members} initialKind={initialKind ?? undefined} />
    </Card>
  );
}
