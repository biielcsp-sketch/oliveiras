"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { parseBRL } from "@/lib/financas/money";
import { todaySP } from "@/lib/financas/today";
import { validateManualTransaction, UUID_RE, optUuid } from "@/lib/financas/transaction-input";
import { extractDocument } from "@/lib/financas/documentos/extract";
import { docsAiAllowedFor } from "@/lib/financas/documentos/access";
import { cleanText, DOC_LIMITS } from "@/lib/financas/documentos/schema";
import { applyExtraction, readUploadedFile, revalidateDocPaths, storePendingDocument } from "@/lib/financas/documentos/store";
import { DOC_BUCKET, isDocPath, planDocDelete, retry, sameBillMonthDocs, type DocRef } from "@/lib/financas/documentos/rules";
import {
  boletoEditConflict, duplicateBlock, editSaveError, readBarcode, validateBoletoEdit, validateBoletoForm, validateComprovanteEdit,
} from "@/lib/financas/documentos/input";
import { BILL_KIND_REQUIRED, dueMonth, parseBillKind, parsePayTarget, validateOneOffInput } from "@/lib/financas/avulsas";
import { runBaixaAutomatica } from "@/lib/financas/baixa-data";
import { flowOrigin, flowReturnPath } from "@/lib/financas/routes";

export type DocState = { error?: string } | null;

type Db = Awaited<ReturnType<typeof createClient>>;

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const GENERIC = "Não foi possível salvar. Tente de novo.";
/** Índice único do banco (boleto igual ou outro boleto do mês confirmado ao mesmo tempo por outra pessoa). */
const CONFLICT = "Outro boleto igual ou do mesmo mês acabou de ser confirmado. Recarregue a página e confira de novo.";

const refresh = revalidateDocPaths;

/** Data de referência do documento (dia do envio, fuso SP): decide o ciclo do fator de vencimento. */
const refDate = (createdAt: string) => todaySP(new Date(createdAt));

async function loadDoc(db: Db, householdId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data } = await db
    .from("fin_documents")
    .select("id, status, kind, barcode, file_path, created_at, one_off_bill_id")
    .eq("household_id", householdId)
    .eq("id", id)
    .maybeSingle();
  return data as { id: string; status: string; kind: string; barcode: string | null; file_path: string; created_at: string; one_off_bill_id: string | null } | null;
}

async function relatedDocs(db: Db, householdId: string, barcode: string | null, billId: string | null): Promise<DocRef[] | null> {
  const cols = "id, kind, status, barcode, bill_id, bill_month, one_off_bill_id";
  const [a, b] = await Promise.all([
    barcode ? db.from("fin_documents").select(cols).eq("household_id", householdId).eq("barcode", barcode) : Promise.resolve({ data: [], error: null }),
    billId ? db.from("fin_documents").select(cols).eq("household_id", householdId).eq("bill_id", billId) : Promise.resolve({ data: [], error: null }),
  ]);
  if (a.error || b.error) return null;
  return [...(a.data ?? []), ...(b.data ?? [])] as DocRef[];
}

/* ---------- Envio + leitura ---------- */

/**
 * Recebe PDF/JPG, confere tamanho e bytes no servidor, guarda no bucket com a sessão (RLS),
 * cria o documento 'pendente' e só então chama a IA. Falha da IA não perde o arquivo.
 */
export async function uploadDocument(_: DocState, form: FormData): Promise<DocState> {
  const { household } = await getAppContext();
  const file = await readUploadedFile(form);
  if (!file.ok) return { error: file.error };

  const db = await createClient();
  const stored = await storePendingDocument(db, household.id, file);
  if (!stored.ok) return { error: stored.error };

  // Família sem leitura automática: o arquivo fica guardado e pendente, sem chamar o Gemini.
  const r = docsAiAllowedFor(household.id) ? await extractDocument(file.bytes, file.kind.mime) : null;
  if (r?.ok) await applyExtraction(db, household.id, stored.id, r.data);
  refresh();
  // `origem` só aceita "casa" (lista fechada); a tela de conferência repassa o mesmo parâmetro.
  redirect(`/financas/documentos/${stored.id}${flowOrigin(str(form, "origem")) === "casa" ? `?origem=casa${/^\d{4}-(0[1-9]|1[0-2])$/.test(str(form, "mes")) ? `&mes=${str(form, "mes")}` : ""}` : ""}`);
}

/* ---------- Conferência: boleto → conta fixa ou conta avulsa ---------- */

export async function confirmBoleto(_: DocState, form: FormData): Promise<DocState> {
  const { household } = await getAppContext();
  const db = await createClient();
  const doc = await loadDoc(db, household.id, str(form, "id"));
  if (!doc) return { error: "Documento não encontrado." };
  if (doc.status !== "pendente") return { error: "Este documento já foi conferido." };
  // O tipo é obrigatório e sem padrão escondido: boleto nenhum vira conta fixa sozinho.
  const billKind = parseBillKind(str(form, "bill_kind"));
  if (!billKind) return { error: BILL_KIND_REQUIRED };
  if (billKind === "avulsa") return confirmBoletoAvulsa(db, household.id, doc, form);

  const v = validateBoletoForm(
    {
      billChoice: str(form, "bill_choice"),
      newName: str(form, "new_name"),
      newDueDay: str(form, "new_due_day"),
      payee: str(form, "payee"),
      amount: str(form, "amount"),
      dueDate: str(form, "due_date"),
      billMonth: str(form, "bill_month"),
      barcode: str(form, "barcode"),
    },
    refDate(doc.created_at),
  );
  if (!v.ok) return { error: v.erro };
  const val = v.value;

  let billId: string | null = null;
  if (val.bill.kind === "existente") {
    const { data: bill } = await db.from("fin_bills").select("id").eq("household_id", household.id).eq("id", val.bill.id).maybeSingle();
    if (!bill) return { error: "Conta fixa não encontrada." };
    billId = bill.id;
  }

  const others = await relatedDocs(db, household.id, val.barcode, billId);
  if (!others) return { error: GENERIC };
  const block = duplicateBlock({
    current: { id: doc.id, barcode: val.barcode },
    kind: "boleto",
    billId,
    billMonth: val.bill_month,
    others,
    replaceSameMonth: form.get("replace_same_month") === "on",
  });
  if (block) return { error: block };

  let createdBill: string | null = null;
  if (val.bill.kind === "nova") {
    const categoryId = optUuid(str(form, "category_id"));
    const accountId = optUuid(str(form, "account_id"));
    if (categoryId) {
      const { data } = await db.from("fin_categories").select("id").eq("household_id", household.id).eq("id", categoryId).maybeSingle();
      if (!data) return { error: "Categoria não encontrada." };
    }
    if (accountId) {
      const { data } = await db.from("fin_accounts").select("id").eq("household_id", household.id).eq("id", accountId).maybeSingle();
      if (!data) return { error: "Conta bancária não encontrada." };
    }
    const { data: bill, error } = await db
      .from("fin_bills")
      .insert({
        household_id: household.id,
        name: val.bill.name,
        amount: val.amount,
        due_day: val.bill.dueDay,
        category_id: categoryId,
        account_id: accountId,
        active: true,
        // Enviado por Casa > Contas: a conta nova já é "da casa".
        is_home: flowOrigin(str(form, "origem")) === "casa",
      })
      .select("id")
      .single();
    if (error || !bill) return { error: "Não foi possível criar a conta fixa." };
    billId = createdBill = bill.id;
  }

  // "Substituir": o(s) boleto(s) confirmado(s) da mesma conta+mês viram 'descartado' ANTES de confirmar
  // o novo (o índice único só aceita um confirmado por conta+mês). O arquivo antigo fica como histórico.
  const replaced =
    billId && form.get("replace_same_month") === "on"
      ? sameBillMonthDocs(doc.id, billId, val.bill_month, others).map((d) => d.id)
      : [];
  if (replaced.length) {
    const { error: e } = await db
      .from("fin_documents")
      .update({ status: "descartado" })
      .eq("household_id", household.id)
      .eq("status", "confirmado")
      .in("id", replaced);
    if (e) {
      if (createdBill) await db.from("fin_bills").delete().eq("household_id", household.id).eq("id", createdBill);
      return { error: GENERIC };
    }
  }
  const undoReplace = async () => {
    if (replaced.length)
      await db.from("fin_documents").update({ status: "confirmado" }).eq("household_id", household.id).eq("status", "descartado").in("id", replaced);
  };

  // O valor fixo da conta existente não muda: o boleto do mês guarda o valor e o vencimento dele.
  const { data: updated, error } = await db
    .from("fin_documents")
    .update({
      kind: "boleto",
      status: "confirmado",
      payee: val.payee,
      amount: val.amount,
      due_date: val.due_date,
      barcode: val.barcode,
      bill_id: billId,
      bill_month: val.bill_month,
      one_off_bill_id: null,
      transaction_id: null,
    })
    .eq("household_id", household.id)
    .eq("id", doc.id)
    .eq("status", "pendente")
    .select("id");
  if (error || !updated?.length) {
    await undoReplace();
    if (createdBill) await db.from("fin_bills").delete().eq("household_id", household.id).eq("id", createdBill);
    return { error: error?.code === "23505" ? CONFLICT : GENERIC };
  }
  // O pagamento pode ter chegado no extrato antes do boleto: cruza agora (mesma sessão, RLS).
  await runBaixaAutomatica([val.bill_month]);
  refresh();
  redirect(flowReturnPath(str(form, "origem"), `/financas/contas-fixas?mes=${val.bill_month}`, val.bill_month));
}

/**
 * Boleto → conta avulsa (paga uma vez só). Cria a linha em fin_one_off_bills (da casa quando veio de
 * Casa > Contas) e liga o documento a ela (one_off_bill_id; sem bill_id/bill_month). Se o documento não
 * puder ser confirmado, a avulsa criada é apagada.
 */
async function confirmBoletoAvulsa(
  db: Db,
  householdId: string,
  doc: NonNullable<Awaited<ReturnType<typeof loadDoc>>>,
  form: FormData,
): Promise<DocState> {
  const v = validateOneOffInput({ name: str(form, "oneoff_name"), amount: str(form, "amount"), dueDate: str(form, "due_date") });
  if (!v.ok) return { error: v.erro };
  const code = readBarcode(str(form, "barcode"), refDate(doc.created_at));
  if (!code.ok) return { error: code.erro };
  const val = v.value;
  const month = dueMonth(val.due_date)!;

  const categoryId = optUuid(str(form, "category_id"));
  const accountId = optUuid(str(form, "account_id"));
  if (categoryId) {
    const { data } = await db.from("fin_categories").select("id").eq("household_id", householdId).eq("id", categoryId).maybeSingle();
    if (!data) return { error: "Categoria não encontrada." };
  }
  if (accountId) {
    const { data } = await db.from("fin_accounts").select("id").eq("household_id", householdId).eq("id", accountId).maybeSingle();
    if (!data) return { error: "Conta bancária não encontrada." };
  }

  const others = await relatedDocs(db, householdId, code.value, null);
  if (!others) return { error: GENERIC };
  const block = duplicateBlock({ current: { id: doc.id, barcode: code.value }, kind: "boleto", billId: null, billMonth: null, others, replaceSameMonth: false });
  if (block) return { error: block };

  const { data: created, error: createError } = await db
    .from("fin_one_off_bills")
    .insert({
      household_id: householdId,
      name: val.name,
      amount: val.amount,
      due_date: val.due_date,
      category_id: categoryId,
      account_id: accountId,
      // Enviado por Casa > Contas: a avulsa também aparece lá.
      is_home: flowOrigin(str(form, "origem")) === "casa",
    })
    .select("id")
    .single();
  if (createError || !created) return { error: "Não foi possível criar a conta avulsa." };

  const { data: updated, error } = await db
    .from("fin_documents")
    .update({
      kind: "boleto",
      status: "confirmado",
      payee: cleanText(str(form, "payee"), DOC_LIMITS.payee),
      amount: val.amount,
      due_date: val.due_date,
      barcode: code.value,
      bill_id: null,
      bill_month: null,
      one_off_bill_id: created.id,
      transaction_id: null,
    })
    .eq("household_id", householdId)
    .eq("id", doc.id)
    .eq("status", "pendente")
    .select("id");
  if (error || !updated?.length) {
    await db.from("fin_one_off_bills").delete().eq("household_id", householdId).eq("id", created.id);
    return { error: error?.code === "23505" ? CONFLICT : GENERIC };
  }
  // O pagamento pode ter chegado no extrato antes do boleto: cruza agora (mesma sessão, RLS).
  await runBaixaAutomatica([month]);
  refresh();
  redirect(flowReturnPath(str(form, "origem"), `/financas/contas-fixas?mes=${month}`, month));
}

/* ---------- Conferência: comprovante → lançamento (e conta paga) ---------- */

export async function confirmComprovante(_: DocState, form: FormData): Promise<DocState> {
  const { household, me } = await getAppContext();
  const db = await createClient();
  const doc = await loadDoc(db, household.id, str(form, "id"));
  if (!doc) return { error: "Documento não encontrado." };
  if (doc.status !== "pendente") return { error: "Este documento já foi conferido." };

  // Mesmas regras do lançamento manual; comprovante é sempre saída.
  const parsed = validateManualTransaction({
    accountId: str(form, "account_id"),
    description: str(form, "description"),
    value: parseBRL(str(form, "amount")),
    date: str(form, "date"),
    direction: "saida",
    categoryId: str(form, "category_id"),
    memberId: me?.id ?? null,
  });
  if ("error" in parsed) return { error: parsed.error };
  const tx = parsed.data;
  const code = readBarcode(str(form, "barcode"), refDate(doc.created_at));
  if (!code.ok) return { error: code.erro };
  const target = parsePayTarget(str(form, "pay_bill_id"), str(form, "pay_month"));
  if (!target.ok) return { error: target.erro };
  const link = target.value?.kind === "fixa" ? { value: { billId: target.value.billId, month: target.value.month } } : { value: null };

  const [{ data: account }, category] = await Promise.all([
    db.from("fin_accounts").select("id, archived").eq("household_id", household.id).eq("id", tx.account_id).maybeSingle(),
    tx.category_id
      ? db.from("fin_categories").select("id, kind").eq("household_id", household.id).eq("id", tx.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!account || account.archived) return { error: "Conta bancária não encontrada." };
  if (tx.category_id && (!category.data || category.data.kind === "receita")) return { error: "Categoria inválida para uma saída." };

  let bill: { id: string; name: string } | null = null;
  if (link.value) {
    const { data } = await db.from("fin_bills").select("id, name").eq("household_id", household.id).eq("id", link.value.billId).maybeSingle();
    if (!data) return { error: "Conta fixa não encontrada." };
    bill = data;
    const { data: paid } = await db
      .from("fin_bill_payments")
      .select("id")
      .eq("household_id", household.id)
      .eq("bill_id", bill.id)
      .eq("month", link.value.month)
      .maybeSingle();
    if (paid) return { error: `${bill.name} já está paga em ${link.value.month.slice(5)}/${link.value.month.slice(0, 4)}. Desmarque a opção ou desfaça o pagamento antes.` };
  }
  let oneOff: { id: string; name: string } | null = null;
  if (target.value?.kind === "avulsa") {
    const { data } = await db.from("fin_one_off_bills").select("id, name, paid_on").eq("household_id", household.id).eq("id", target.value.id).maybeSingle();
    if (!data) return { error: "Conta avulsa não encontrada." };
    if (data.paid_on) return { error: `${data.name} já está paga. Desmarque a opção ou desfaça o pagamento antes.` };
    oneOff = { id: data.id, name: data.name };
  }

  const others = await relatedDocs(db, household.id, code.value, null);
  if (!others) return { error: GENERIC };
  const block = duplicateBlock({ current: { id: doc.id, barcode: code.value }, kind: "comprovante", billId: null, billMonth: null, others, replaceSameMonth: false });
  if (block) return { error: block };

  const { data: inserted, error: txError } = await db
    .from("fin_transactions")
    .insert({ ...tx, household_id: household.id, source: "documento" })
    .select("id")
    .single();
  if (txError || !inserted) return { error: "Não foi possível salvar o lançamento. Confira conta e categoria." };
  const undoTx = () => db.from("fin_transactions").delete().eq("household_id", household.id).eq("id", inserted.id);

  let paymentId: string | null = null;
  if (bill && link.value) {
    const { data: pay, error } = await db
      .from("fin_bill_payments")
      .insert({ household_id: household.id, bill_id: bill.id, month: link.value.month, transaction_id: inserted.id, paid_on: tx.date, amount: Math.abs(tx.amount) })
      .select("id")
      .single();
    if (error || !pay) {
      await undoTx();
      return { error: error?.code === "23505" ? `${bill.name} já está paga neste mês.` : "Não foi possível marcar a conta como paga." };
    }
    paymentId = pay.id;
  }
  // Avulsa: o pagamento fica na própria linha. Só grava se ainda estiver em aberto (outra pessoa pode ter pago).
  const undoOneOff = async () => {
    if (oneOff)
      await db
        .from("fin_one_off_bills")
        .update({ paid_on: null, transaction_id: null, paid_auto: false })
        .eq("household_id", household.id)
        .eq("id", oneOff.id)
        .eq("transaction_id", inserted.id);
  };
  if (oneOff) {
    const { data: paidRows, error } = await db
      .from("fin_one_off_bills")
      .update({ paid_on: tx.date, transaction_id: inserted.id, paid_auto: false })
      .eq("household_id", household.id)
      .eq("id", oneOff.id)
      .is("paid_on", null)
      .select("id");
    if (error || !paidRows?.length) {
      await undoTx();
      return { error: `${oneOff.name} já está paga ou não pôde ser marcada como paga.` };
    }
  }

  const { data: updated, error } = await db
    .from("fin_documents")
    .update({
      kind: "comprovante",
      status: "confirmado",
      payee: cleanText(str(form, "payee"), DOC_LIMITS.payee),
      amount: Math.abs(tx.amount),
      paid_on: tx.date,
      barcode: code.value,
      transaction_id: inserted.id,
      // A conta paga fica em fin_bill_payments (ligada ao lançamento). bill_id/bill_month no documento
      // são só do boleto: o índice único (um confirmado por conta+mês) não distingue o tipo.
      bill_id: null,
      bill_month: null,
      one_off_bill_id: null,
    })
    .eq("household_id", household.id)
    .eq("id", doc.id)
    .eq("status", "pendente")
    .select("id");
  if (error || !updated?.length) {
    if (paymentId) await db.from("fin_bill_payments").delete().eq("household_id", household.id).eq("id", paymentId);
    await undoOneOff();
    await undoTx();
    return { error: error?.code === "23505" ? CONFLICT : GENERIC };
  }
  refresh();
  redirect(flowReturnPath(str(form, "origem"), `/financas/lancamentos?mes=${tx.date.slice(0, 7)}`, tx.date.slice(0, 7)));
}

/* ---------- Outro: guardar ou descartar ---------- */

export async function keepDocument(form: FormData) {
  const { household } = await getAppContext();
  const db = await createClient();
  const doc = await loadDoc(db, household.id, str(form, "id"));
  if (doc && doc.status === "pendente") {
    await db.from("fin_documents").update({ kind: "outro", status: "confirmado" }).eq("household_id", household.id).eq("id", doc.id).eq("status", "pendente");
  }
  refresh();
  redirect(flowReturnPath(str(form, "origem"), "/financas/documentos", str(form, "mes")));
}

/** Descarta: status 'descartado' e o arquivo sai do bucket. Lançamentos e contas já criados ficam. */
export async function discardDocument(form: FormData) {
  const { household } = await getAppContext();
  const db = await createClient();
  const doc = await loadDoc(db, household.id, str(form, "id"));
  if (doc) {
    // Boleto substituído já está 'descartado' mas guarda o arquivo; o descarte manual apaga.
    const { data } =
      doc.status === "descartado"
        ? { data: [doc] }
        : await db.from("fin_documents").update({ status: "descartado" }).eq("household_id", household.id).eq("id", doc.id).select("id");
    if (data?.length && isDocPath(doc.file_path)) await db.storage.from(DOC_BUCKET).remove([doc.file_path]);
  }
  refresh();
  redirect(flowReturnPath(str(form, "origem"), "/financas/documentos", str(form, "mes")));
}

/* ---------- Editar documento confirmado ---------- */

export async function editDocument(_: DocState, form: FormData): Promise<DocState> {
  const { household } = await getAppContext();
  const db = await createClient();
  const doc = await loadDoc(db, household.id, str(form, "id"));
  if (!doc) return { error: "Documento não encontrado." };
  if (doc.status !== "confirmado") return { error: "Só documentos confirmados podem ser editados." };

  // Boleto de conta avulsa: valor, vencimento e nome se editam na própria conta avulsa.
  if (doc.kind === "boleto" && doc.one_off_bill_id) return { error: "Este boleto é de uma conta avulsa: edite pela conta avulsa." };
  if (doc.kind === "boleto") {
    const v = validateBoletoEdit({ billId: str(form, "bill_id"), amount: str(form, "amount"), dueDate: str(form, "due_date"), billMonth: str(form, "bill_month") });
    if (!v.ok) return { error: v.erro };
    const val = v.value;
    const { data: bill } = await db.from("fin_bills").select("id").eq("household_id", household.id).eq("id", val.bill_id).maybeSingle();
    if (!bill) return { error: "Conta fixa não encontrada." };
    const others = await relatedDocs(db, household.id, null, bill.id);
    if (!others) return { error: GENERIC };
    const conflict = boletoEditConflict(doc.id, bill.id, val.bill_month, others);
    if (conflict) return { error: conflict };
    const { data: updated, error } = await db
      .from("fin_documents")
      .update({ amount: val.amount, due_date: val.due_date, bill_id: bill.id, bill_month: val.bill_month })
      .eq("household_id", household.id)
      .eq("id", doc.id)
      .eq("status", "confirmado")
      .eq("kind", "boleto")
      .select("id");
    if (error || !updated?.length) return { error: editSaveError(error?.code) };
    // Valor ou mês mudou: o pagamento pode estar no extrato.
    await runBaixaAutomatica([val.bill_month]);
  } else if (doc.kind === "comprovante") {
    const v = validateComprovanteEdit({ amount: str(form, "amount"), paidOn: str(form, "paid_on"), payee: str(form, "payee") });
    if (!v.ok) return { error: v.erro };
    const { data: updated, error } = await db
      .from("fin_documents")
      .update(v.value)
      .eq("household_id", household.id)
      .eq("id", doc.id)
      .eq("status", "confirmado")
      .eq("kind", "comprovante")
      .select("id");
    if (error || !updated?.length) return { error: editSaveError(error?.code) };
  } else {
    return { error: "Este tipo de documento não tem dados para editar." };
  }
  refresh();
  redirect(`/financas/documentos/${doc.id}`);
}

/* ---------- Apagar documento (e o arquivo) ---------- */

/**
 * Apaga o documento e o arquivo do bucket, com a sessão (RLS). O arquivo sai primeiro, com até 3
 * tentativas e conferência de que sumiu: se não sair, nada é apagado (a linha continua sendo a dona
 * do arquivo). Modo "tudo": apaga também o lançamento criado por este documento e a baixa ligada a ele.
 */
export async function deleteDocument(_: DocState, form: FormData): Promise<DocState> {
  const { household } = await getAppContext();
  const db = await createClient();
  const id = str(form, "id");
  if (!UUID_RE.test(id)) return { error: "Documento não encontrado." };
  const { data: doc } = await db
    .from("fin_documents")
    .select("id, file_path, transaction_id")
    .eq("household_id", household.id)
    .eq("id", id)
    .maybeSingle();
  if (!doc) return { error: "Documento não encontrado." };
  const mode = str(form, "mode") === "tudo" ? "tudo" : "documento";

  let tx: { id: string; source: string } | null = null;
  let otherDocsWithTx = 0;
  if (mode === "tudo" && doc.transaction_id) {
    const [{ data: t }, { count }] = await Promise.all([
      db.from("fin_transactions").select("id, source").eq("household_id", household.id).eq("id", doc.transaction_id).maybeSingle(),
      db.from("fin_documents").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("transaction_id", doc.transaction_id).neq("id", doc.id),
    ]);
    tx = t;
    otherDocsWithTx = count ?? 0;
  }
  const plan = planDocDelete({ mode, docTransactionId: doc.transaction_id, tx, otherDocsWithTx });

  if (isDocPath(doc.file_path)) {
    const bucket = db.storage.from(DOC_BUCKET);
    const gone = await retry(async () => {
      const { error } = await bucket.remove([doc.file_path]);
      if (error) return false;
      // O Storage não acusa erro quando não apaga (ex.: RLS): confere se sumiu mesmo.
      // exists() devolve false só para "não existe"; outros erros lançam e o retry tenta de novo.
      const { data: still } = await bucket.exists(doc.file_path);
      return still === false;
    });
    if (!gone) return { error: "Não consegui apagar o arquivo. Nada foi apagado; tente de novo em instantes." };
  }

  const { data: removed, error } = await db.from("fin_documents").delete().eq("household_id", household.id).eq("id", doc.id).select("id");
  if (error || !removed?.length) return { error: "O arquivo foi apagado, mas o registro não. Tente apagar de novo." };

  if (plan.transactionId) {
    await db.from("fin_bill_payments").delete().eq("household_id", household.id).eq("transaction_id", plan.transactionId);
    // Avulsa paga por este lançamento volta a ficar em aberto (o FK só zeraria o lançamento, deixando "paga").
    await db
      .from("fin_one_off_bills")
      .update({ paid_on: null, transaction_id: null, paid_auto: false })
      .eq("household_id", household.id)
      .eq("transaction_id", plan.transactionId);
    await db.from("fin_transactions").delete().eq("household_id", household.id).eq("id", plan.transactionId).eq("source", "documento");
  }
  refresh();
  redirect("/financas/documentos");
}
