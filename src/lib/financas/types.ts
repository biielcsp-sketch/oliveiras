export type CategoryKind = "despesa" | "receita" | "transferencia";
export type Category = { id: string; name: string; kind: CategoryKind; color: string };
export type Transaction = {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: number;
  category_id: string | null;
  member_id: string | null;
  notes: string | null;
  source: string;
};

export type AccountKind = "corrente" | "poupanca" | "cartao" | "dinheiro" | "investimento";

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  owner_member_id: string | null;
  opening_balance: number;
  credit_limit: number | null;
  closing_day: number | null;
  due_day: number | null;
  archived: boolean;
  balance: number;
  external_id: string | null;
  pluggy_item_ref: string | null;
  sync_from: string | null;
  bank_balance: number | null;
  bank_balance_at: string | null;
};

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  cartao: "Cartão de crédito",
  dinheiro: "Dinheiro",
  investimento: "Investimento",
};

export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = {
  despesa: "Despesas",
  receita: "Receitas",
  transferencia: "Transferências (fora dos totais)",
};

export type Bill = {
  id: string;
  name: string;
  amount: number;
  due_day: number;
  category_id: string | null;
  account_id: string | null;
  active: boolean;
};
export type BillPayment = {
  id: string;
  bill_id: string;
  month: string;
  /** true só quando a baixa automática gravou (0016); "Marcar paga" manual é false. */
  auto?: boolean;
  transaction_id: string | null;
  paid_on: string;
  amount: number;
};
export type Goal = { id: string; name: string; target: number; account_id: string | null; target_date: string | null };
