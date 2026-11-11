import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getBills } from "@/lib/financas/planning-data";
import { BillForm } from "../../_components/bill-form";
import { billDeletePath } from "@/lib/financas/routes";

export const metadata = { title: "Editar conta fixa" };

export default async function EditarContaFixaPage({ params }: { params: Promise<{ id: string }> }) {
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
      <LinkButton href={billDeletePath(bill.id)} variant="danger" className="w-full">
        <Trash2 size={16} aria-hidden /> Excluir conta fixa
      </LinkButton>
    </div>
  );
}
