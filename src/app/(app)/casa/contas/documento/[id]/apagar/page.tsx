import { flowMonth } from "@/lib/financas/routes";
import { ApagarDocumento } from "../../../../../financas/_components/apagar-documento";

export const metadata = { title: "Apagar documento · Casa" };

/** Apagar documento enviado por Casa > Contas: mesma tela das Finanças, dentro da Casa; ao apagar volta para Contas no mês. */
export default async function ApagarDocumentoCasaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id } = await params;
  const { mes } = await searchParams;
  return <ApagarDocumento id={id} origem="casa" mes={flowMonth(mes)} />;
}
