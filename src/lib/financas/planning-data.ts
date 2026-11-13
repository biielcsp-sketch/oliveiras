import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { monthRange, shiftMonth } from "./period";
import type { BudgetRow } from "./planning";
import type { Bill, BillPayment, Goal, Transaction } from "./types";
import type { OneOffBill } from "./avulsas";
import { fetchAllPages, markList, type TxList } from "./paginate";

const num = (v: unknown) => Number(v);

export async function getBudgetRows(): Promise<BudgetRow[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase.from("fin_budgets").select("category_id, month, amount").eq("household_id", household.id);
  return (data ?? []).map((r) => ({ ...r, amount: num(r.amount) }));
}

export async function getBills(): Promise<Bill[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_bills")
    .select("id, name, amount, due_day, category_id, account_id, active, is_home")
    .eq("household_id", household.id)
    .order("due_day");
  return (data ?? []).map((b) => ({ ...b, amount: num(b.amount), is_home: b.is_home === true }));
}

export async function getBillPayments(month: string): Promise<BillPayment[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_bill_payments")
    .select("id, bill_id, month, transaction_id, paid_on, amount, auto")
    .eq("household_id", household.id)
    .eq("month", month);
  return (data ?? []).map((p) => ({ ...p, amount: num(p.amount) }));
}

/** Dos lançamentos informados, quais já estão vinculados a alguma conta paga (fixa ou avulsa). */
export async function getLinkedTransactionIds(transactionIds: string[]): Promise<Set<string>> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const linked = new Set<string>();
  for (let i = 0; i < transactionIds.length; i += 300) {
    const part = transactionIds.slice(i, i + 300);
    const [{ data }, { data: oneOff }] = await Promise.all([
      supabase.from("fin_bill_payments").select("transaction_id").eq("household_id", household.id).in("transaction_id", part),
      supabase.from("fin_one_off_bills").select("transaction_id").eq("household_id", household.id).in("transaction_id", part),
    ]);
    [...(data ?? []), ...(oneOff ?? [])].forEach((r) => r.transaction_id && linked.add(r.transaction_id));
  }
  return linked;
}

/* ---------- Contas avulsas (0021) ---------- */

const ONE_OFF_COLS = "id, name, amount, due_date, category_id, account_id, is_home, paid_on, transaction_id, paid_auto";
const toOneOff = (r: Record<string, unknown>) =>
  ({ ...r, amount: num(r.amount), is_home: r.is_home === true, paid_auto: r.paid_auto === true }) as OneOffBill;

/** Avulsas com vencimento no mês. */
export async function getOneOffBillsForMonth(month: string): Promise<OneOffBill[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { start, end } = monthRange(month);
  const { data } = await supabase
    .from("fin_one_off_bills")
    .select(ONE_OFF_COLS)
    .eq("household_id", household.id)
    .gte("due_date", start)
    .lt("due_date", end)
    .order("due_date");
  return (data ?? []).map(toOneOff);
}

/** Avulsas em aberto (não pagas), da que vence antes; `untilMonth`: só as que vencem até o fim desse mês. */
export async function getOpenOneOffBills(untilMonth?: string): Promise<OneOffBill[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  let q = supabase.from("fin_one_off_bills").select(ONE_OFF_COLS).eq("household_id", household.id).is("paid_on", null);
  if (untilMonth) q = q.lt("due_date", monthRange(untilMonth).end);
  const { data } = await q.order("due_date").limit(200);
  return (data ?? []).map(toOneOff);
}

export async function getOneOffBill(id: string): Promise<OneOffBill | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase.from("fin_one_off_bills").select(ONE_OFF_COLS).eq("household_id", household.id).eq("id", id).maybeSingle();
  return data ? toOneOff(data) : null;
}

/** Boleto confirmado de cada avulsa (link do arquivo na lista). */
export async function getOneOffBoletoDocs(ids: string[]): Promise<Map<string, { id: string; file_mime: string }>> {
  const map = new Map<string, { id: string; file_mime: string }>();
  if (ids.length === 0) return map;
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_documents")
    .select("id, one_off_bill_id, file_mime")
    .eq("household_id", household.id)
    .eq("status", "confirmado")
    .eq("kind", "boleto")
    .in("one_off_bill_id", ids.slice(0, 300));
  for (const d of data ?? []) if (d.one_off_bill_id && !map.has(d.one_off_bill_id)) map.set(d.one_off_bill_id, { id: d.id, file_mime: d.file_mime });
  return map;
}

export async function getGoals(): Promise<Goal[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_goals")
    .select("id, name, target, account_id, target_date")
    .eq("household_id", household.id)
    .order("created_at");
  return (data ?? []).map((g) => ({ ...g, target: num(g.target) }));
}

/** Lançamentos entre o início de (mês−2) e o fim de (mês+1): cobre faturas e janelas de pagamento. */
export async function getTransactionsAround(month: string, accountIds?: string[]): Promise<TxList<Transaction>> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  // Paginado: o antigo `.limit(3000)` voltava no máximo 1000 (max_rows do PostgREST), sem aviso.
  const { rows, incomplete } = await fetchAllPages((from, to) => {
    let q = supabase
      .from("fin_transactions")
      .select("id, account_id, date, description, amount, category_id, member_id, notes, source")
      .eq("household_id", household.id)
      .gte("date", monthRange(shiftMonth(month, -2)).start)
      .lt("date", monthRange(shiftMonth(month, 1)).end);
    if (accountIds) q = q.in("account_id", accountIds.length ? accountIds : ["00000000-0000-0000-0000-000000000000"]);
    return q.order("date", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });
  return markList(rows.map((t) => ({ ...t, amount: num(t.amount) })), incomplete);
}
