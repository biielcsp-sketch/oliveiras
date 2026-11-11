import { Card, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { BillForm } from "../../_components/bill-form";

export const metadata = { title: "Nova conta fixa" };

export default async function NovaContaFixaPage() {
  const { categories, accounts } = await getFinanceBase();
  return (
    <Card>
      <PageHeader title="Nova conta fixa" subtitle="Contas que se repetem todo mês" />
      <BillForm categories={categories} accounts={accounts} />
    </Card>
  );
}
