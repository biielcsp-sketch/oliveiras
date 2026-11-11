import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getBills } from "@/lib/financas/planning-data";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { getDocument } from "@/lib/financas/documentos/data";
import { KIND_LABEL } from "@/lib/financas/documentos/rules";
import { DocEditForm } from "../../../_components/doc-edit-form";

export const metadata = { title: "Editar documento" };

export default async function EditarDocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const doc = await getDocument(id);
  // Só confirmado e com dados para editar; pendente se confere na tela do documento.
  if (!doc || doc.status !== "confirmado" || (doc.kind !== "boleto" && doc.kind !== "comprovante")) notFound();
  const back = (
    <Link href={`/financas/documentos/${doc.id}`} className="text-[15px] font-medium text-link">
      Voltar
    </Link>
  );

  if (doc.kind === "boleto") {
    const bills = await getBills();
    // Conta pausada continua na lista se for a do boleto.
    const options = bills.filter((b) => b.active || b.id === doc.bill_id).map((b) => ({ id: b.id, name: b.name }));
    return (
      <Card>
        <PageHeader title={`Editar ${KIND_LABEL.boleto.toLowerCase()}`} subtitle={doc.payee ?? undefined} action={back} />
        <DocEditForm kind="boleto" id={doc.id} amount={doc.amount} dueDate={doc.due_date} billId={doc.bill_id} billMonth={doc.bill_month} bills={options} />
      </Card>
    );
  }
  return (
    <Card>
      <PageHeader title={`Editar ${KIND_LABEL.comprovante.toLowerCase()}`} subtitle={doc.payee ?? undefined} action={back} />
      <DocEditForm kind="comprovante" id={doc.id} amount={doc.amount} paidOn={doc.paid_on} payee={doc.payee} transactionId={doc.transaction_id} />
    </Card>
  );
}
