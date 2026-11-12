import { ApagarDocumento } from "../../../_components/apagar-documento";

export const metadata = { title: "Apagar documento" };

export default async function ApagarDocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApagarDocumento id={id} origem={null} />;
}
