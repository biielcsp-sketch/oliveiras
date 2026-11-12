import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { formatBRL } from "@/lib/financas/money";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { getDocument } from "@/lib/financas/documentos/data";
import { KIND_LABEL, planDocDelete } from "@/lib/financas/documentos/rules";
import { DocDeleteForm } from "../../../_components/doc-delete-form";

export const metadata = { title: "Apagar documento" };

export default async function ApagarDocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { household } = await getAppContext();
  const doc = await getDocument(id);
  if (!doc) notFound();

  // Mesma regra do servidor ao apagar: só oferece apagar o lançamento que este documento criou.
  let createdTransaction = false;
  let paid: "fixa" | "avulsa" | null = null;
  if (doc.transaction_id) {
    const db = await createClient();
    const [{ data: tx }, { count }, { data: pay }, { data: oneOff }] = await Promise.all([
      db.from("fin_transactions").select("id, source").eq("household_id", household.id).eq("id", doc.transaction_id).maybeSingle(),
      db.from("fin_documents").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("transaction_id", doc.transaction_id).neq("id", doc.id),
      db.from("fin_bill_payments").select("id").eq("household_id", household.id).eq("transaction_id", doc.transaction_id).limit(1).maybeSingle(),
      db.from("fin_one_off_bills").select("id").eq("household_id", household.id).eq("transaction_id", doc.transaction_id).limit(1).maybeSingle(),
    ]);
    createdTransaction = planDocDelete({ mode: "tudo", docTransactionId: doc.transaction_id, tx, otherDocsWithTx: count ?? 0 }).transactionId !== null;
    paid = pay ? "fixa" : oneOff ? "avulsa" : null;
  }

  return (
    <Card>
      <PageHeader
        title="Apagar documento?"
        subtitle={`${KIND_LABEL[doc.kind]}${doc.payee ? ` · ${doc.payee}` : ""}${doc.amount !== null ? ` · ${formatBRL(doc.amount)}` : ""}`}
      />
      <div className="mb-5 flex flex-col gap-2 text-[15px]">
        <p>O documento e o arquivo (PDF ou foto) serão apagados de vez. Não dá para desfazer.</p>
        {createdTransaction && (
          <p>
            Este documento criou um{" "}
            <Link href={`/financas/lancamentos/${doc.transaction_id}`} className="font-medium text-link">lançamento</Link>
            {paid ? ` e marcou uma conta ${paid} como paga` : ""}. Escolha se eles ficam ou saem junto.
          </p>
        )}
        {doc.transaction_id && !createdTransaction && (
          <p className="text-muted">O lançamento ligado a este documento não foi criado por ele e continua.</p>
        )}
      </div>
      <DocDeleteForm id={doc.id} createdTransaction={createdTransaction} />
      <Link href={`/financas/documentos/${doc.id}`} className="mt-4 block text-center text-[15px] font-medium text-link">
        Cancelar
      </Link>
    </Card>
  );
}
