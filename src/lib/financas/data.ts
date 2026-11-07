import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { monthRange } from "./period";


export type { Account, AccountKind, Category, CategoryKind, Transaction } from "./types";
export { ACCOUNT_KIND_LABEL, CATEGORY_KIND_LABEL } from "./types";
import type { Account, Category, Transaction } from "./types";
export type RuleRow = { id: string; pattern: string; category_id: string };


const TX_COLUMNS = "id, account_id, date, description, amount, category_id, member_id, notes, source";

/** Contas (com saldo), categorias e regras da família. */
export const getFinanceBase = cache(async () => {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const [accounts, balances, categories, rules] = await Promise.all([
    supabase
      .from("fin_accounts")
      .select("id, name, kind, institution, owner_member_id, opening_balance, credit_limit, closing_day, due_day, archived")
      .eq("household_id", household.id)
      .order("archived")
      .order("name"),
    supabase.from("fin_account_balances").select("account_id, balance").eq("household_id", household.id),
    supabase.from("fin_categories").select("id, name, kind, color").eq("household_id", household.id).order("name"),
    supabase.from("fin_rules").select("id, pattern, category_id").eq("household_id", household.id).order("pattern"),
  ]);

  const balanceById = new Map((balances.data ?? []).map((b) => [b.account_id, Number(b.balance)]));
  return {
    accounts: (accounts.data ?? []).map((a) => ({
      ...a,
      opening_balance: Number(a.opening_balance),
      credit_limit: a.credit_limit === null ? null : Number(a.credit_limit),
      balance: balanceById.get(a.id) ?? Number(a.opening_balance),
    })) as Account[],
    categories: (categories.data ?? []) as Category[],
    rules: (rules.data ?? []) as RuleRow[],
  };
});

export type TxFilters = { month: string; account?: string; category?: string; q?: string };

/** Lançamentos do mês com filtros opcionais. */
export async function getTransactions(filters: TxFilters): Promise<Transaction[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { start, end } = monthRange(filters.month);
  let query = supabase
    .from("fin_transactions")
    .select(TX_COLUMNS)
    .eq("household_id", household.id)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (filters.account) query = query.eq("account_id", filters.account);
  if (filters.category === "sem") query = query.is("category_id", null);
  else if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.q) {
    // % e _ viram literais na busca
    const term = filters.q.slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.ilike("description", `%${term}%`);
  }

  const { data } = await query;
  return (data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as Transaction[];
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_transactions")
    .select(TX_COLUMNS)
    .eq("household_id", household.id)
    .eq("id", id)
    .maybeSingle();
  return data ? ({ ...data, amount: Number(data.amount) } as Transaction) : null;
}
