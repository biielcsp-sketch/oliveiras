import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { getFinanceBase, getTransaction } from "@/lib/financas/data";
import { TxForm } from "../../_components/tx-form";
import { deleteTransaction } from "../../actions";
import { getDocumentForTransaction } from "@/lib/financas/documentos/data";

export const metadata = { title: "Editar lançamento" };

const SOURCE = {
  manual: "lançado à mão",
  ofx: "importado de OFX",
  csv: "importado de CSV",
  openfinance: "Open Finance",
  documento: "lido de documento (PDF ou foto)",
} as const;

export default async function EditarLancamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ members, me }, { accounts, categories }, tx] = await Promise.all([
    getAppContext(),
    getFinanceBase(),
    getTransaction(id),
  ]);
  if (!tx) notFound();
  const doc = tx.source === "documento" ? await getDocumentForTransaction(tx.id) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <PageHeader title="Editar lançamento" subtitle={SOURCE[tx.source as keyof typeof SOURCE] ?? tx.source} />
        {doc && (
          <p className="-mt-4 mb-5 flex gap-4 text-sm font-medium">
            <a href={`/financas/documentos/${doc.id}/arquivo`} target="_blank" rel="noopener" className="text-link">
              {doc.file_mime === "application/pdf" ? "Abrir PDF do comprovante" : "Abrir foto do comprovante"}
            </a>
            <Link href={`/financas/documentos/${doc.id}`} className="text-link">Ver documento</Link>
          </p>
        )}
        <TxForm
          tx={tx}
          accounts={accounts}
          categories={categories}
          members={members}
          defaultMemberId={me?.id ?? null}
          today={tx.date}
        />
      </Card>
      <form action={deleteTransaction}>
        <input type="hidden" name="id" value={tx.id} />
        <Button variant="danger" className="w-full">
          <Trash2 size={16} /> Excluir lançamento
        </Button>
      </form>
    </div>
  );
}
