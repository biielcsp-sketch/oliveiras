import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getOneOffBill } from "@/lib/financas/planning-data";
import { casaContasPath, flowOrigin, oneOffPath } from "@/lib/financas/routes";
import { parseMonth } from "@/lib/financas/period";
import { OneOffDeleteForm } from "../../../../_components/oneoff-delete-form";

export const metadata = { title: "Apagar conta avulsa" };

/** Confirmação antes de apagar: o boleto e o lançamento que a pagou ficam. */
export default async function ExcluirContaAvulsaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ voltar?: string; mes?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const voltar = flowOrigin(sp.voltar) ?? undefined;
  const mes = sp.mes ? parseMonth(sp.mes) : undefined;
  const oneOff = await getOneOffBill(id);
  if (!oneOff) notFound();
  const cancelHref = voltar === "casa" ? casaContasPath(mes) : oneOffPath(id);

  return (
    <Card>
      <PageHeader title="Apagar conta avulsa" subtitle={oneOff.name} />
      <div className="mb-5 flex flex-col gap-2 text-[15px]">
        <p>
          Vai apagar a conta avulsa <strong>{oneOff.name}</strong>
          {oneOff.paid_on ? " e o registro do pagamento dela" : ""}.
        </p>
        <p>O boleto fica guardado em Documentos, sem vínculo com a conta.</p>
        <p className="text-muted">Os lançamentos do extrato não são apagados. Esta ação não pode ser desfeita.</p>
      </div>
      <OneOffDeleteForm id={id} voltar={voltar} mes={mes} cancelHref={cancelHref} />
    </Card>
  );
}
