"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { parseBRL } from "@/lib/financas/money";

export type PlanState = { error?: string; ok?: boolean } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX = 10_000_000;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const uuid = (v: string) => (UUID.test(v) ? v : null);
const validDate = (v: string) => ISO_DATE.test(v) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v);

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/inicio");
}

/* ---------- Orçamento ---------- */

/** Define o orçamento da categoria: para todos os meses (padrão) ou só para o mês. Vazio remove. */
export async function saveBudget(_: PlanState, form: FormData): Promise<PlanState> {
  const { household } = await getAppContext();
  const categoryId = uuid(str(form, "category_id"));
  const scope = str(form, "scope");
  const month = str(form, "month");
  if (!categoryId) return { error: "Categoria inválida." };
  if (!MONTH.test(month)) return { error: "Mês inválido." };
  const targetMonth = scope === "mes" ? month : null;

  const supabase = await createClient();
  const raw = str(form, "amount");
  if (!raw) {
    let del = supabase.from("fin_budgets").delete().eq("household_id", household.id).eq("category_id", categoryId);
    del = targetMonth ? del.eq("month", targetMonth) : del.is("month", null);
    await del;
    refresh();
    return { ok: true };
  }
  const amount = parseBRL(raw);
  if (amount === null || amount < 0 || amount > MAX) return { error: "Valor inválido." };
  // Remover é sempre permitido; criar/alterar só em categoria de despesa.
  const { data: category } = await supabase
    .from("fin_categories")
    .select("kind")
    .eq("id", categoryId)
    .eq("household_id", household.id)
    .maybeSingle();
  if (category?.kind !== "despesa") return { error: "Orçamento só vale para categorias de despesa." };

  const { error } = await supabase
    .from("fin_budgets")
    .upsert(
      { household_id: household.id, category_id: categoryId, month: targetMonth, amount },
      { onConflict: "household_id,category_id,month" },
    );
  if (error) return { error: "Não foi possível salvar o orçamento." };
  refresh();
  return { ok: true };
}

/* ---------- Contas a pagar ---------- */

export async function saveBill(_: PlanState, form: FormData): Promise<PlanState> {
  const { household } = await getAppContext();
  const name = str(form, "name");
  const amount = parseBRL(str(form, "amount"));
  const dueDay = Number(str(form, "due_day"));
  if (!name || name.length > 60) return { error: "Dê um nome à conta (até 60 letras)." };
  if (amount === null || amount <= 0 || amount > MAX) return { error: "Valor inválido." };
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return { error: "Dia de vencimento entre 1 e 31." };

  const data = {
    name,
    amount,
    due_day: dueDay,
    category_id: uuid(str(form, "category_id")),
    account_id: uuid(str(form, "account_id")),
    active: form.get("inactive") !== "on",
  };
  const supabase = await createClient();
  const id = uuid(str(form, "id"));
  const { error } = id
    ? await supabase.from("fin_bills").update(data).eq("id", id).eq("household_id", household.id)
    : await supabase.from("fin_bills").insert({ ...data, household_id: household.id });
  if (error) return { error: "Não foi possível salvar a conta." };
  refresh();
  redirect("/financas/contas-a-pagar");
}

export async function deleteBill(form: FormData) {
  const { household } = await getAppContext();
  const id = uuid(str(form, "id"));
  if (id) {
    const supabase = await createClient();
    await supabase.from("fin_bills").delete().eq("id", id).eq("household_id", household.id);
  }
  refresh();
  redirect("/financas/contas-a-pagar");
}

/** Marca a conta do mês como paga, ligada a um lançamento do extrato ou sem lançamento. */
export async function payBill(_: PlanState, form: FormData): Promise<PlanState> {
  const { household } = await getAppContext();
  const billId = uuid(str(form, "bill_id"));
  const month = str(form, "month");
  const choice = str(form, "transaction_id");
  if (!billId || !MONTH.test(month)) return { error: "Dados inválidos." };

  const supabase = await createClient();
  let row: { transaction_id: string | null; paid_on: string; amount: number };

  if (choice && choice !== "sem") {
    const txId = uuid(choice);
    if (!txId) return { error: "Lançamento inválido." };
    const { data: tx } = await supabase
      .from("fin_transactions")
      .select("id, date, amount")
      .eq("id", txId)
      .eq("household_id", household.id)
      .maybeSingle();
    if (!tx || Number(tx.amount) >= 0) return { error: "Escolha um lançamento de saída desta família." };
    row = { transaction_id: tx.id, paid_on: tx.date, amount: Math.abs(Number(tx.amount)) };
  } else {
    const paidOn = str(form, "paid_on");
    const amount = parseBRL(str(form, "amount"));
    if (!validDate(paidOn)) return { error: "Data do pagamento inválida." };
    if (amount === null || amount <= 0 || amount > MAX) return { error: "Valor pago inválido." };
    row = { transaction_id: null, paid_on: paidOn, amount };
  }

  const { error } = await supabase
    .from("fin_bill_payments")
    .insert({ household_id: household.id, bill_id: billId, month, ...row });
  if (error) {
    if (error.code === "23505") return { error: "Esta conta já está paga neste mês, ou o lançamento já pagou outra conta." };
    return { error: "Não foi possível registrar o pagamento." };
  }
  refresh();
  redirect(`/financas/contas-a-pagar?mes=${month}`);
}

export async function undoPayment(form: FormData) {
  const { household } = await getAppContext();
  const id = uuid(str(form, "id"));
  const month = str(form, "month");
  if (id) {
    const supabase = await createClient();
    await supabase.from("fin_bill_payments").delete().eq("id", id).eq("household_id", household.id);
  }
  refresh();
  redirect(`/financas/contas-a-pagar${MONTH.test(month) ? `?mes=${month}` : ""}`);
}

/* ---------- Metas ---------- */

export async function saveGoal(_: PlanState, form: FormData): Promise<PlanState> {
  const { household } = await getAppContext();
  const name = str(form, "name");
  const target = parseBRL(str(form, "target"));
  const targetDate = str(form, "target_date");
  if (!name || name.length > 60) return { error: "Dê um nome à meta (até 60 letras)." };
  if (target === null || target <= 0 || target > 100_000_000) return { error: "Valor da meta inválido." };
  if (targetDate && !validDate(targetDate)) return { error: "Data inválida." };
  const accountId = uuid(str(form, "account_id"));
  if (!accountId) return { error: "Escolha a conta onde o dinheiro da meta fica guardado." };

  const data = { name, target, account_id: accountId, target_date: targetDate || null };
  const supabase = await createClient();
  const id = uuid(str(form, "id"));
  const { error } = id
    ? await supabase.from("fin_goals").update(data).eq("id", id).eq("household_id", household.id)
    : await supabase.from("fin_goals").insert({ ...data, household_id: household.id });
  if (error) return { error: "Não foi possível salvar a meta." };
  refresh();
  redirect("/financas/metas");
}

export async function deleteGoal(form: FormData) {
  const { household } = await getAppContext();
  const id = uuid(str(form, "id"));
  if (id) {
    const supabase = await createClient();
    await supabase.from("fin_goals").delete().eq("id", id).eq("household_id", household.id);
  }
  refresh();
  redirect("/financas/metas");
}
