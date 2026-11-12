"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { dismissOneOffPair, transactionUses } from "@/lib/financas/baixa-data";
import { dueMonth, txPayConflict, validateOneOffInput } from "@/lib/financas/avulsas";
import { CONTAS_FIXAS, flowReturnPath } from "@/lib/financas/routes";
import { optUuid, validDate } from "@/lib/financas/transaction-input";

/**
 * Contas avulsas (fin_one_off_bills): editar, apagar, marcar paga, desfazer e recusar sugestão.
 * Tudo com a sessão do usuário (RLS) e filtrando pelo household do servidor.
 */
export type OneOffState = { error?: string } | null;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const listPath = (month: string | null) => (month ? `${CONTAS_FIXAS}?mes=${month}` : CONTAS_FIXAS);

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/inicio");
  // Avulsas da casa aparecem em /casa/contas.
  revalidatePath("/casa", "layout");
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function loadOneOff(db: Db, householdId: string, id: string | null) {
  if (!id) return null;
  const { data } = await db
    .from("fin_one_off_bills")
    .select("id, name, due_date, paid_on, transaction_id, paid_auto")
    .eq("household_id", householdId)
    .eq("id", id)
    .maybeSingle();
  return data as { id: string; name: string; due_date: string; paid_on: string | null; transaction_id: string | null; paid_auto: boolean } | null;
}

/** Edita nome, valor, vencimento, categoria, conta e "da casa". O pagamento (se houver) não muda. */
export async function saveOneOff(_: OneOffState, form: FormData): Promise<OneOffState> {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (!id) return { error: "Conta avulsa inválida." };
  const v = validateOneOffInput({ name: str(form, "name"), amount: str(form, "amount"), dueDate: str(form, "due_date") });
  if (!v.ok) return { error: v.erro };
  const db = await createClient();
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
  const { data, error } = await db
    .from("fin_one_off_bills")
    .update({ ...v.value, category_id: categoryId, account_id: accountId, is_home: form.get("is_home") === "on" })
    .eq("household_id", household.id)
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { error: "Não foi possível salvar a conta avulsa." };
  refresh();
  redirect(listPath(dueMonth(v.value.due_date)));
}

/**
 * Apaga a avulsa. As recusas de baixa saem em cascata; o boleto (documento) e o lançamento que a pagou
 * ficam (o documento só perde o vínculo). Só redireciona se uma linha foi mesmo apagada.
 */
export async function deleteOneOff(_: OneOffState, form: FormData): Promise<OneOffState> {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (!id) return { error: "Conta avulsa inválida." };
  const db = await createClient();
  const { data, error } = await db.from("fin_one_off_bills").delete().eq("household_id", household.id).eq("id", id).select("due_date");
  if (error || !data?.length) return { error: "Não foi possível apagar a conta avulsa. Recarregue a página e tente de novo." };
  refresh();
  const mes = str(form, "mes");
  redirect(flowReturnPath(str(form, "voltar"), listPath(MONTH.test(mes) ? mes : dueMonth(data[0].due_date)), mes));
}

/**
 * Marca a avulsa como paga: ligada a um lançamento de saída desta família ou sem lançamento (só a data).
 * O lançamento não pode já ter pago outra conta, fixa ou avulsa.
 */
export async function payOneOff(_: OneOffState, form: FormData): Promise<OneOffState> {
  const { household } = await getAppContext();
  const db = await createClient();
  const oneOff = await loadOneOff(db, household.id, optUuid(str(form, "one_off_id")));
  if (!oneOff) return { error: "Conta avulsa não encontrada." };
  if (oneOff.paid_on) return { error: `${oneOff.name} já está paga.` };

  const choice = str(form, "transaction_id");
  let row: { paid_on: string; transaction_id: string | null };
  if (choice && choice !== "sem") {
    const txId = optUuid(choice);
    if (!txId) return { error: "Lançamento inválido." };
    const { data: tx } = await db.from("fin_transactions").select("id, date, amount").eq("household_id", household.id).eq("id", txId).maybeSingle();
    if (!tx || Number(tx.amount) >= 0) return { error: "Escolha um lançamento de saída desta família." };
    const conflict = txPayConflict({ kind: "avulsa", id: oneOff.id }, await transactionUses(db, household.id, tx.id));
    if (conflict) return { error: conflict };
    row = { paid_on: tx.date, transaction_id: tx.id };
  } else {
    const paidOn = str(form, "paid_on");
    if (!validDate(paidOn)) return { error: "Data do pagamento inválida." };
    row = { paid_on: paidOn, transaction_id: null };
  }

  const { data, error } = await db
    .from("fin_one_off_bills")
    .update({ ...row, paid_auto: false })
    .eq("household_id", household.id)
    .eq("id", oneOff.id)
    .is("paid_on", null)
    .select("id");
  if (error) {
    if (error.code === "23505") return { error: "Este lançamento já pagou outra conta avulsa." };
    return { error: "Não foi possível registrar o pagamento." };
  }
  if (!data?.length) return { error: `${oneOff.name} já está paga.` };
  refresh();
  redirect(listPath(dueMonth(oneOff.due_date)));
}

/** Desfaz o pagamento. Baixa automática desfeita grava a recusa ANTES, para nenhuma sincronização refazer o par. */
export async function undoOneOffPayment(form: FormData) {
  const { household } = await getAppContext();
  const db = await createClient();
  const oneOff = await loadOneOff(db, household.id, optUuid(str(form, "id")));
  if (oneOff?.paid_on) {
    const dismissed = oneOff.paid_auto && oneOff.transaction_id ? await dismissOneOffPair(oneOff.id, oneOff.transaction_id, "desfeita") : true;
    if (dismissed)
      await db
        .from("fin_one_off_bills")
        .update({ paid_on: null, transaction_id: null, paid_auto: false })
        .eq("household_id", household.id)
        .eq("id", oneOff.id);
  }
  refresh();
  const month = str(form, "month");
  redirect(listPath(MONTH.test(month) ? month : oneOff ? dueMonth(oneOff.due_date) : null));
}

/** "Não é": a sugestão some para a família e o par avulsa+lançamento nunca vira baixa automática. */
export async function dismissOneOffSuggestion(form: FormData) {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "one_off_id"));
  const txId = optUuid(str(form, "transaction_id"));
  if (id && txId) {
    const db = await createClient();
    const [{ data: oneOff }, { data: tx }] = await Promise.all([
      db.from("fin_one_off_bills").select("id").eq("household_id", household.id).eq("id", id).maybeSingle(),
      db.from("fin_transactions").select("id").eq("household_id", household.id).eq("id", txId).maybeSingle(),
    ]);
    if (oneOff && tx) await dismissOneOffPair(oneOff.id, tx.id, "nao_e");
  }
  refresh();
  const month = str(form, "month");
  redirect(listPath(MONTH.test(month) ? month : null));
}
