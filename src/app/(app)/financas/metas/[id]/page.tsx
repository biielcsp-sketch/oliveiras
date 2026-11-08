import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getGoals } from "@/lib/financas/planning-data";
import { GoalForm } from "../../_components/goal-form";
import { deleteGoal } from "../../planning-actions";

export const metadata = { title: "Editar meta" };

export default async function EditarMetaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ accounts }, goals] = await Promise.all([getFinanceBase(), getGoals()]);
  const goal = goals.find((g) => g.id === id);
  if (!goal) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <PageHeader title={goal.name} />
        <GoalForm goal={goal} accounts={accounts} />
      </Card>
      <form action={deleteGoal}>
        <input type="hidden" name="id" value={goal.id} />
        <Button variant="danger" className="w-full">
          <Trash2 size={16} /> Excluir meta
        </Button>
      </form>
    </div>
  );
}
