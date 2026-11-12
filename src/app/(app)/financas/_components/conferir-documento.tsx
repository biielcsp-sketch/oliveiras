import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { getFinanceBase } from "@/lib/financas/data";
import { getBills, getOneOffBill, getOpenOneOffBills } from "@/lib/financas/planning-data";
import { oneOffOption } from "@/lib/financas/avulsas";
import { formatBRL } from "@/lib/financas/money";
import { shiftMonth } from "@/lib/financas/period";
import { todaySP } from "@/lib/financas/today";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { casaContasPath, docDeletePath } from "@/lib/financas/routes";
import { getDocument, getRelatedDocs } from "@/lib/financas/documentos/data";
import { toLinhaDigitavel } from "@/lib/financas/documentos/boleto";
import { docEditBlock, ORPHAN_BOLETO_EDIT } from "@/lib/financas/documentos/input";
import { reconcile, storedExtracted } from "@/lib/financas/documentos/schema";
import { DOC_BUCKET, isDocPath, KIND_LABEL, monthOf, sameBarcodeDocs, STATUS_LABEL, suggestBill } from "@/lib/financas/documentos/rules";
import { DocReview } from "./doc-review";
import { docsAiAllowedFor } from "@/lib/financas/documentos/access";

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

/**
 * Conteúdo da tela de conferência/detalhe do documento, usado nas duas rotas:
 * /financas/documentos/[id] (Finanças, "+" do Oli) e /casa/contas/documento/[id] (enviado por Casa > Contas,
 * com o menu da Casa). `origem` e `mes` já chegam validados pela rota (lista fechada e AAAA-MM).
 */
export async function ConferirDocumento({ id, origem, mes }: { id: string; origem: "casa" | null; mes?: string }) {
  if (!UUID_RE.test(id)) notFound();
  const back =
    origem === "casa" ? (
      <Link href={casaContasPath(mes)} className="mt-4 block text-center text-[15px] font-medium text-link">
        Voltar para Contas
      </Link>
    ) : null;
  const { household } = await getAppContext();
  const doc = await getDocument(id);
  if (!doc) notFound();
  const fileHref = `/financas/documentos/${doc.id}/arquivo`;
  const isPdf = doc.file_mime === "application/pdf";

  const [{ accounts, categories }, bills] = await Promise.all([getFinanceBase(), getBills()]);
  const billName = new Map(bills.map((b) => [b.id, b.name]));

  if (doc.status !== "pendente") {
    const oneOff = doc.one_off_bill_id ? await getOneOffBill(doc.one_off_bill_id) : null;
    // Descartado à mão apagou o arquivo; boleto substituído guarda o arquivo como histórico.
    const hasFile =
      doc.status !== "descartado" ||
      (isDocPath(doc.file_path) && (await (await createClient()).storage.from(DOC_BUCKET).exists(doc.file_path)).data === true);
    return (
      <Card>
        <PageHeader title={doc.payee ?? KIND_LABEL[doc.kind]} subtitle={`${KIND_LABEL[doc.kind]} · ${STATUS_LABEL[doc.status]}`} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
          {doc.amount !== null && (<><dt className="text-muted">Valor</dt><dd className="tabular-nums">{formatBRL(doc.amount)}</dd></>)}
          {doc.due_date && (<><dt className="text-muted">Vencimento</dt><dd>{br(doc.due_date)}</dd></>)}
          {doc.paid_on && (<><dt className="text-muted">Pago em</dt><dd>{br(doc.paid_on)}</dd></>)}
          {doc.bill_id && (<><dt className="text-muted">Conta</dt><dd>{billName.get(doc.bill_id) ?? "—"}{doc.bill_month && ` (${doc.bill_month.slice(5)}/${doc.bill_month.slice(0, 4)})`}</dd></>)}
          {oneOff && (<><dt className="text-muted">Conta avulsa</dt><dd>{oneOff.name}{oneOff.paid_on ? ` · paga em ${br(oneOff.paid_on)}` : ""}</dd></>)}
        </dl>
        {docEditBlock(doc) === ORPHAN_BOLETO_EDIT && <p className="mt-4 text-[15px] text-muted">{ORPHAN_BOLETO_EDIT}</p>}
        <div className="mt-5 flex flex-wrap gap-4 text-[15px] font-medium">
          {hasFile && (
            <a href={fileHref} target="_blank" rel="noopener" className="text-link">{isPdf ? "Abrir PDF" : "Abrir foto"}</a>
          )}
          {doc.transaction_id && <Link href={`/financas/lancamentos/${doc.transaction_id}`} className="text-link">Ver lançamento</Link>}
          {doc.bill_month && doc.kind === "boleto" && <Link href={`/financas/contas-fixas?mes=${doc.bill_month}`} className="text-link">Ver em Contas fixas</Link>}
          {oneOff && <Link href={`/financas/contas-fixas?mes=${oneOff.due_date.slice(0, 7)}`} className="text-link">Ver em Contas avulsas</Link>}
        </div>
        <div className="mt-5 flex flex-wrap gap-4 text-sm">
          {docEditBlock(doc) === null && (
            <Link href={`/financas/documentos/${doc.id}/editar`} className="font-medium text-link">Editar documento</Link>
          )}
          {doc.status === "confirmado" && oneOff && (
            <Link href={`/financas/contas-fixas/avulsa/${oneOff.id}`} className="font-medium text-link">Editar conta avulsa</Link>
          )}
          <Link href={docDeletePath(doc.id, origem, mes)} className="text-danger underline">Apagar documento</Link>
        </div>
        {back}
      </Card>
    );
  }

  const ex = storedExtracted(doc.extracted);
  const reference = todaySP(new Date(doc.created_at));

  const readFailed = !ex;

  // Pendente: o código lido fica em `extracted` (forma canônica quando passa nos DVs) até a confirmação.
  const rec = ex ? reconcile(ex, reference) : null;
  const barcode = doc.barcode ?? rec?.codigo ?? null;
  const related = await getRelatedDocs(barcode, bills.map((b) => b.id));
  const dupBoleto = sameBarcodeDocs({ id: doc.id, barcode }, "boleto", related).map((d) => d.id);
  const dupComprovante = sameBarcodeDocs({ id: doc.id, barcode }, "comprovante", related).map((d) => d.id);
  // Comprovante de um boleto já conferido: sugere marcar paga a mesma conta/mês.
  const boletoLink = related.find((d) => d.kind === "boleto" && d.status === "confirmado" && d.barcode && d.barcode === barcode && d.bill_id && d.bill_month);
  const openOneOffs = await getOpenOneOffBills();
  // Boleto de avulsa (ainda em aberto) com o mesmo código: sugere marcar paga essa avulsa.
  const oneOffLink = related.find(
    (d) => d.kind === "boleto" && d.status === "confirmado" && d.barcode && d.barcode === barcode && d.one_off_bill_id && openOneOffs.some((o) => o.id === d.one_off_bill_id),
  );

  const baseMonth = monthOf(doc.due_date) ?? monthOf(doc.paid_on) ?? reference.slice(0, 7);
  const db = await createClient();
  const { data: payments } = await db
    .from("fin_bill_payments")
    .select("bill_id, month")
    .eq("household_id", household.id)
    .gte("month", shiftMonth(baseMonth, -3))
    .lte("month", shiftMonth(baseMonth, 3));

  const activeBills = bills.filter((b) => b.active);
  const suggested = suggestBill(doc.payee, activeBills);

  return (
    <Card>
      <PageHeader
        title="Conferir documento"
        subtitle="Confira o que foi lido antes de salvar."
        action={
          <a href={fileHref} target="_blank" rel="noopener" className="text-[15px] font-medium text-link">
            {isPdf ? "Abrir PDF" : "Abrir foto"}
          </a>
        }
      />
      {readFailed && (
        <p role="status" className="mb-4 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
          {docsAiAllowedFor(household.id)
            ? "Não consegui ler este documento automaticamente. O arquivo está guardado; preencha os campos à mão."
            : "A leitura automática não está disponível para esta família. O arquivo está guardado; preencha os campos à mão."}
        </p>
      )}
      <DocReview
        doc={{
          id: doc.id,
          kind: doc.kind,
          payee: doc.payee,
          amount: doc.amount,
          dueDate: doc.due_date,
          paidOn: doc.paid_on,
          linha: barcode ? (toLinhaDigitavel(barcode) ?? barcode) : "",
          description: ex?.descricao ?? null,
        }}
        today={todaySP()}
        avisos={rec?.avisos ?? []}
        bills={activeBills.map((b) => ({ id: b.id, name: b.name, amount: b.amount, due_day: b.due_day }))}
        suggestedBillId={suggested?.id ?? null}
        accounts={accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        confirmedBoletos={related.filter((d) => d.status === "confirmado" && d.kind === "boleto")}
        paidKeys={(payments ?? []).map((p) => `${p.bill_id}:${p.month}`)}
        dupBoleto={dupBoleto}
        dupComprovante={dupComprovante}
        oneOffs={openOneOffs.map((o) => ({ id: o.id, name: o.name, due_date: o.due_date }))}
        boletoLink={
          boletoLink
            ? { target: boletoLink.bill_id!, month: boletoLink.bill_month! }
            : oneOffLink
              ? { target: oneOffOption(oneOffLink.one_off_bill_id!), month: null }
              : null
        }
        origem={origem}
        mes={mes}
      />
      <Link href={docDeletePath(doc.id, origem, mes)} className="mt-4 block text-center text-sm text-danger underline">
        Apagar documento
      </Link>
      {back}
    </Card>
  );
}
