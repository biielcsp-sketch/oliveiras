import { Card, EmptyState } from "@/components/ui";
import { getRecentDocuments } from "@/lib/financas/documentos/data";
import { sortDocs } from "@/lib/financas/documentos/rules";
import { DocUpload } from "../_components/doc-upload";
import { DocList } from "../_components/doc-list";

export const metadata = { title: "Documentos" };

export default async function DocumentosPage() {
  const docs = sortDocs(await getRecentDocuments(50));
  return (
    <div className="flex flex-col gap-4">
      <DocUpload showListLink={false} />
      {docs.length === 0 ? (
        <EmptyState title="Nenhum documento lido ainda">Envie o PDF ou a foto de um boleto ou comprovante.</EmptyState>
      ) : (
        <Card className="py-1">
          <h2 className="pt-3 font-medium">Documentos recentes</h2>
          <DocList docs={docs} />
        </Card>
      )}
    </div>
  );
}
