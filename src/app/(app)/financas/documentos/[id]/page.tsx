import { notFound, redirect } from "next/navigation";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { docReviewPath, flowOrigin } from "@/lib/financas/routes";
import { ConferirDocumento } from "../../_components/conferir-documento";

export const metadata = { title: "Conferir documento" };

/**
 * Conferência pelas Finanças (e pelo "+" do Oli). Link antigo com `?origem=casa` vai para a mesma tela dentro
 * da Casa (destino montado só com valores validados).
 */
export default async function ConferirDocumentoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ origem?: string; mes?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  if (flowOrigin(sp.origem) === "casa") redirect(docReviewPath(id, "casa", sp.mes));
  return <ConferirDocumento id={id} origem={null} />;
}
