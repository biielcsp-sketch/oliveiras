"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { parseBRL } from "@/lib/financas/money";
import { todaySP } from "@/lib/financas/today";
import { validateManualTransaction, UUID_RE, optUuid } from "@/lib/financas/transaction-input";
import { checkUpload, MAX_FILE_BYTES } from "@/lib/saude/files";
import { extractDocument } from "@/lib/financas/documentos/extract";
import { docsAiAllowedFor } from "@/lib/financas/documentos/access";
import { cleanText, DOC_LIMITS, reconcile } from "@/lib/financas/documentos/schema";
import { dailyLimitError, docStoragePath, DOC_BUCKET, isDocPath, sameBillMonthDocs, spDayStartIso, type DocRef } from "@/lib/financas/documentos/rules";
import { duplicateBlock, readBarcode, validateBoletoForm, validatePayLink } from "@/lib/financas/documentos/input";

export type DocState = { error?: string } | null;

type Db = Awaited<ReturnType<typeof createClient>>;

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const GENERIC = "Não foi possível salvar. Tente de novo.";
/** Índice único do banco (boleto igual ou outro boleto do mês confirmado ao mesmo tempo por outra pessoa). */
const CONFLICT = "Outro boleto igual ou do mesmo mês acabou de ser confirmado. Recarregue a página e confira de novo.";

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/inicio");
}

/** Data de referência do documento (dia do envio, fuso SP): decide o ciclo do fator de vencimento. */
const refDate = (createdAt: string) => todaySP(new Date(createdAt));

async function loadDoc(db: Db, householdId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data } = await db
    .from("fin_documents")
    .select("id, status, kind, barcode, file_path, created_at")
    .eq("household_id", householdId)
    .eq("id", id)
    .maybeSingle();
  return data as { id: string; status: string; kind: string; barcode: string | null; file_path: string; created_at: string } | null;
}

async function relatedDocs(db: Db, householdId: string, barcode: string | null, billId: string | null): Promise<DocRef[] | null> {
  const cols = "id, kind, status, barcode, bill_id, bill_month";
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
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Escolha um PDF ou uma foto (JPG)." };
  if (file.size > MAX_FILE_BYTES) return { error: "O arquivo passa de 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes);
  if (!check.ok) return { error: check.erro };

  const db = await createClient();
  const today = todaySP();
  const { count, error: countError } = await db
    .from("fin_documents")
    .select("id", { count: "exact", head: true })
    .eq("household_id", household.id)
    .gte("created_at", spDayStartIso(today));
  if (countError) return { error: GENERIC };
  const limit = dailyLimitError(count ?? 0);
  if (limit) return { error: limit };

  const path = docStoragePath(household.id, randomUUID(), check.kind.ext);
  const up = await db.storage.from(DOC_BUCKET).upload(path, bytes, { contentType: check.kind.mime, upsert: false });
  if (up.error) return { error: "Não foi possível enviar o arquivo. Tente de novo." };

  const { data: doc, error } = await db
    .from("fin_documents")
    .insert({ household_id: household.id, kind: "outro", status: "pendente", file_path: path, file_mime: check.kind.mime, file_size: bytes.length })
    .select("id")
    .single();
  if (error || !doc) {
    await db.storage.from(DOC_BUCKET).remove([path]);
    return { error: GENERIC };
  }

  // Família sem leitura automática: o arquivo fica guardado e pendente, sem chamar o Gemini.
  const r = docsAiAllowedFor(household.id) ? await extractDocument(bytes, check.kind.mime) : null;
  if (r?.ok) {
    const rec = reconcile(r.data, today);
    // Sugestões para a conferência; nada vira lançamento ou conta sem o usuário confirmar.
    await db
      .from("fin_documents")
      .update({
        extracted: r.data,
        kind: rec.tipo,
        payee: rec.beneficiario,
        amount: rec.valor,
        due_date: rec.vencimento,
        paid_on: rec.data_pagamento,
        // A coluna barcode só é gravada na confirmação (índice único de boletos não descartados);
        // até lá o código fica em `extracted` e a conferência mostra o aviso de duplicidade.
      })
      .eq("household_id", household.id)
      .eq("id", doc.id);
  }
  refresh();
  redirect(`/financas/documentos/${doc.id}`);
}

/* ---------- Conferência: boleto → conta a pagar ---------- */

export async function confirmBoleto(_: DocState, form: FormData): Promise<DocState> {
  const { household } = await getAppContext();
  const db = await createClient();
  const doc = await loadDoc(db, household.id, str(form, "id"));
  if (!doc) return { error: "Documento não encontrado." };
  if (doc.status !== "pendente") return { error: "Este documento já foi conferido." };

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
    if (!bill) return { error: "Conta a pagar não encontrada." };
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
      .insert({ household_id: household.id, name: val.bill.name, amount: val.amount, due_day: val.bill.dueDay, category_id: categoryId, account_id: accountId, active: true })
      .select("id")
      .single();
    if (error || !bill) return { error: "Não foi possível criar a conta a pagar." };
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
  refresh();
  redirect(`/financas/contas-a-pagar?mes=${val.bill_month}`);
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
  const link = validatePayLink(str(form, "pay_bill_id"), str(form, "pay_month"));
  if (!link.ok) return { error: link.erro };

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
    if (!data) return { error: "Conta a pagar não encontrada." };
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
    })
    .eq("household_id", household.id)
    .eq("id", doc.id)
    .eq("status", "pendente")
    .select("id");
  if (error || !updated?.length) {
    if (paymentId) await db.from("fin_bill_payments").delete().eq("household_id", household.id).eq("id", paymentId);
    await undoTx();
    return { error: error?.code === "23505" ? CONFLICT : GENERIC };
  }
  refresh();
  redirect(`/financas/lancamentos?mes=${tx.date.slice(0, 7)}`);
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
  redirect("/financas/documentos");
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
  redirect("/financas/documentos");
}
