import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { monthRange } from "./period";
import { fetchAllPages, markList, type TxList } from "./paginate";


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
      .select(
        "id, name, kind, institution, owner_member_id, opening_balance, credit_limit, closing_day, due_day, archived, external_id, pluggy_item_ref, sync_from, bank_balance, bank_balance_at",
      )
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
      bank_balance: a.bank_balance === null ? null : Number(a.bank_balance),
      balance: balanceById.get(a.id) ?? Number(a.opening_balance),
    })) as Account[],
    categories: (categories.data ?? []) as Category[],
    rules: (rules.data ?? []) as RuleRow[],
  };
});

export type TxFilters = { month: string; account?: string; category?: string; q?: string };

/**
 * Lançamentos do mês com filtros opcionais, todos (paginado; o PostgREST corta em 1000 por resposta).
 * `incomplete` = passou do teto de segurança ou uma página falhou: a tela avisa e não trata o total como completo.
 */
export async function getTransactions(filters: TxFilters): Promise<TxList<Transaction>> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { start, end } = monthRange(filters.month);
  const term = filters.q ? filters.q.slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`) : null; // % e _ viram literais

  const { rows, incomplete } = await fetchAllPages((from, to) => {
    let query = supabase
      .from("fin_transactions")
      .select(TX_COLUMNS)
      .eq("household_id", household.id)
      .gte("date", start)
      .lt("date", end);
    if (filters.account) query = query.eq("account_id", filters.account);
    if (filters.category === "sem") query = query.is("category_id", null);
    else if (filters.category) query = query.eq("category_id", filters.category);
    if (term) query = query.ilike("description", `%${term}%`);
    // Ordem estável (id desempata) para as páginas não repetirem nem pularem linhas.
    return query
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
  });
  return markList(rows.map((t) => ({ ...t, amount: Number(t.amount) })) as Transaction[], incomplete);
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
