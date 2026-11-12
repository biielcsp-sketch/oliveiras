import { flowMonth } from "@/lib/financas/routes";
import { ConferirDocumento } from "../../../../financas/_components/conferir-documento";

export const metadata = { title: "Conferir documento · Casa" };

/**
 * Conferência de documento enviado por Casa > Contas: mesma tela das Finanças, mas dentro da Casa (menu da
 * Casa e aba Contas marcados). Confirmar, guardar, descartar e voltar retornam para Casa > Contas no mês.
 */
export default async function ConferirDocumentoCasaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id } = await params;
  const { mes } = await searchParams;
  return <ConferirDocumento id={id} origem="casa" mes={flowMonth(mes)} />;
}
