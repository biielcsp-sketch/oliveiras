import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { AccountForm } from "../../_components/account-form";

export const metadata = { title: "Nova conta" };

export default async function NovaContaPage() {
  const { members } = await getAppContext();
  return (
    <Card>
      <PageHeader title="Nova conta" subtitle="Conta, poupança, cartão, dinheiro ou investimento" />
      <AccountForm members={members} />
    </Card>
  );
}
