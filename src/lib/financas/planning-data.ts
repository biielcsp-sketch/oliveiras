import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { monthRange, shiftMonth } from "./period";
import type { BudgetRow } from "./planning";
import type { Bill, BillPayment, Goal, Transaction } from "./types";

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
    .select("id, name, amount, due_day, category_id, account_id, active")
    .eq("household_id", household.id)
    .order("due_day");
  return (data ?? []).map((b) => ({ ...b, amount: num(b.amount) }));
}

export async function getBillPayments(month: string): Promise<BillPayment[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_bill_payments")
    .select("id, bill_id, month, transaction_id, paid_on, amount")
    .eq("household_id", household.id)
    .eq("month", month);
  return (data ?? []).map((p) => ({ ...p, amount: num(p.amount) }));
}

/** Ids de lançamentos já vinculados a alguma conta paga (qualquer mês). */
export async function getLinkedTransactionIds(): Promise<Set<string>> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_bill_payments")
    .select("transaction_id")
    .eq("household_id", household.id)
    .not("transaction_id", "is", null);
  return new Set((data ?? []).map((r) => r.transaction_id as string));
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
export async function getTransactionsAround(month: string, accountIds?: string[]): Promise<Transaction[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  let q = supabase
    .from("fin_transactions")
    .select("id, account_id, date, description, amount, category_id, member_id, notes, source")
    .eq("household_id", household.id)
    .gte("date", monthRange(shiftMonth(month, -2)).start)
    .lt("date", monthRange(shiftMonth(month, 1)).end)
    .order("date", { ascending: false })
    .limit(3000);
  if (accountIds) q = q.in("account_id", accountIds.length ? accountIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  return (data ?? []).map((t) => ({ ...t, amount: num(t.amount) }));
}
