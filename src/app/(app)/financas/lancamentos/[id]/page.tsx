import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { getFinanceBase, getTransaction } from "@/lib/financas/data";
import { TxForm } from "../../_components/tx-form";
import { deleteTransaction } from "../../actions";

export const metadata = { title: "Editar lançamento" };

const SOURCE = { manual: "lançado à mão", ofx: "importado de OFX", csv: "importado de CSV", openfinance: "Open Finance" } as const;

export default async function EditarLancamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ members, me }, { accounts, categories }, tx] = await Promise.all([
    getAppContext(),
    getFinanceBase(),
    getTransaction(id),
  ]);
  if (!tx) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <PageHeader title="Editar lançamento" subtitle={SOURCE[tx.source as keyof typeof SOURCE] ?? tx.source} />
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
