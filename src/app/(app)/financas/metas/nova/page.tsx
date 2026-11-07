import { Card, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { GoalForm } from "../../_components/goal-form";

export const metadata = { title: "Nova meta" };

export default async function NovaMetaPage() {
  const { accounts } = await getFinanceBase();
  return (
    <Card>
      <PageHeader title="Nova meta" />
      <GoalForm accounts={accounts} />
    </Card>
  );
}
