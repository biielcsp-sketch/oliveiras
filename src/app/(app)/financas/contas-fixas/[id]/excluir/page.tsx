import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { getBills } from "@/lib/financas/planning-data";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { casaContasPath, CONTAS_FIXAS, flowOrigin } from "@/lib/financas/routes";
import { parseMonth } from "@/lib/financas/period";
import { BillDeleteForm } from "../../../_components/bill-delete-form";

export const metadata = { title: "Excluir conta fixa" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Confirmação antes de excluir: mostra o que será apagado e o que fica. Contagens com a sessão do usuário (RLS). */
export default async function ExcluirContaFixaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ voltar?: string; mes?: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const voltar = flowOrigin(sp.voltar) ?? undefined;
  const mes = sp.mes ? parseMonth(sp.mes) : undefined;
  const { household } = await getAppContext();
  const bill = (await getBills()).find((b) => b.id === id);
  if (!bill) notFound();

  const db = await createClient();
  const [pay, docs] = await Promise.all([
    db.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("bill_id", id),
    db.from("fin_documents").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("bill_id", id),
  ]);
  const payments = pay.count ?? 0;
  const documents = docs.count ?? 0;
  const cancelHref = voltar === "casa" ? casaContasPath(mes) : `${CONTAS_FIXAS}/${id}`;

  return (
    <Card>
      <PageHeader title="Excluir conta fixa" subtitle={bill.name} />
      <div className="mb-5 flex flex-col gap-2 text-[15px]">
        <p>
          Vai apagar a conta <strong>{bill.name}</strong> e <strong>{plural(payments, "pagamento registrado", "pagamentos registrados")}</strong> dela.
        </p>
        <p>
          {documents === 0
            ? "Nenhum documento está ligado a ela."
            : `${plural(documents, "documento fica", "documentos ficam")} guardado${documents === 1 ? "" : "s"} em Documentos, sem vínculo com a conta.`}
        </p>
        <p className="text-muted">Os lançamentos do extrato não são apagados. Esta ação não pode ser desfeita.</p>
      </div>
      <BillDeleteForm billId={id} voltar={voltar} mes={mes} cancelHref={cancelHref} />
    </Card>
  );
}
