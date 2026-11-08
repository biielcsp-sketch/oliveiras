import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getBills } from "@/lib/financas/planning-data";
import { BillForm } from "../../_components/bill-form";
import { deleteBill } from "../../planning-actions";

export const metadata = { title: "Editar conta a pagar" };

export default async function EditarContaPagarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ categories, accounts }, bills] = await Promise.all([getFinanceBase(), getBills()]);
  const bill = bills.find((b) => b.id === id);
  if (!bill) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <PageHeader title={bill.name} />
        <BillForm bill={bill} categories={categories} accounts={accounts} />
      </Card>
      <form action={deleteBill}>
        <input type="hidden" name="id" value={bill.id} />
        <Button variant="danger" className="w-full">
          <Trash2 size={16} /> Excluir conta a pagar
        </Button>
      </form>
    </div>
  );
}
