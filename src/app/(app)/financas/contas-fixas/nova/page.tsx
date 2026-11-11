import { Card, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { BillForm } from "../../_components/bill-form";

export const metadata = { title: "Nova conta fixa" };

/** ?casa=1: veio de Casa > Contas ("Nova conta da casa"). */
export default async function NovaContaFixaPage({ searchParams }: { searchParams: Promise<{ casa?: string }> }) {
  const fromCasa = (await searchParams).casa === "1";
  const { categories, accounts } = await getFinanceBase();
  return (
    <Card>
      <PageHeader title={fromCasa ? "Nova conta da casa" : "Nova conta fixa"} subtitle="Contas que se repetem todo mês" />
      <BillForm categories={categories} accounts={accounts} fromCasa={fromCasa} />
    </Card>
  );
}
