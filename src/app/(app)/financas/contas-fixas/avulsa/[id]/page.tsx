import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getOneOffBill } from "@/lib/financas/planning-data";
import { oneOffDeletePath } from "@/lib/financas/routes";
import { OneOffForm } from "../../../_components/oneoff-form";

export const metadata = { title: "Editar conta avulsa" };

export default async function EditarContaAvulsaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ categories, accounts }, oneOff] = await Promise.all([getFinanceBase(), getOneOffBill(id)]);
  if (!oneOff) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <PageHeader title={oneOff.name} subtitle="Conta avulsa (só esta vez)" />
        <OneOffForm oneOff={oneOff} categories={categories} accounts={accounts} />
      </Card>
      <LinkButton href={oneOffDeletePath(oneOff.id)} variant="danger" className="w-full">
        <Trash2 size={16} aria-hidden /> Apagar conta avulsa
      </LinkButton>
    </div>
  );
}
