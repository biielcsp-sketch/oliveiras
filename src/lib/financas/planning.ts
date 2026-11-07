import { shiftMonth } from "./period";
import type { Transaction } from "./types";

/** Dia do mês limitado ao último dia (ex.: dia 31 em fevereiro vira 28/29). */
export function dateInMonth(month: string, day: number) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/* ---------- Fatura do cartão ---------- */

export type Invoice = { month: string; start: string; closing: string; nextClosing: string; due: string };

/**
 * Fatura que vence no mês informado.
 * Se o fechamento é antes do vencimento no mês (fecha 3, vence 10), fecha no mesmo mês;
 * senão (fecha 28, vence 5), fecha no mês anterior.
 * Compras com data >= início e < fechamento entram nesta fatura; compra feita no dia
 * do fechamento já vai para a próxima.
 */
export function invoiceFor(month: string, closingDay: number, dueDay: number): Invoice {
  const closingMonth = closingDay < dueDay ? month : shiftMonth(month, -1);
  return {
    month,
    start: dateInMonth(shiftMonth(closingMonth, -1), closingDay),
    closing: dateInMonth(closingMonth, closingDay),
    nextClosing: dateInMonth(shiftMonth(closingMonth, 1), closingDay),
    due: dateInMonth(month, dueDay),
  };
}

/**
 * Total da fatura e pagamentos identificados. Mesma regra do resumo do mês:
 * - compras (saídas) do período somam;
 * - crédito com categoria de despesa/receita é estorno e abate a fatura;
 * - crédito de transferência ou sem categoria é pagamento: não abate compras e conta
 *   como pago se cair entre o fechamento e o próximo fechamento.
 */
export function invoiceTotals(cardTxs: Transaction[], transferCategoryIds: Set<string>, inv: Invoice) {
  let charges = 0;
  let paid = 0;
  for (const t of cardTxs) {
    const cents = Math.round(t.amount * 100);
    const isPayment = cents > 0 && (t.category_id === null || transferCategoryIds.has(t.category_id));
    const isTransfer = t.category_id !== null && transferCategoryIds.has(t.category_id);
    if (!isPayment && !isTransfer && t.date >= inv.start && t.date < inv.closing) charges -= cents;
    if (isPayment && t.date >= inv.closing && t.date < inv.nextClosing) paid += cents;
  }
  return { total: charges / 100, paid: paid / 100 };
}

/* ---------- Orçamento ---------- */

export type BudgetRow = { category_id: string; month: string | null; amount: number };

/** Valor de cada categoria no mês: o ajuste do mês vence o padrão. */
export function resolveBudgets(rows: BudgetRow[], month: string) {
  const result = new Map<string, { amount: number; override: boolean }>();
  for (const r of rows) if (r.month === null) result.set(r.category_id, { amount: r.amount, override: false });
  for (const r of rows) if (r.month === month) result.set(r.category_id, { amount: r.amount, override: true });
  return result;
}

/* ---------- Contas a pagar ---------- */

export type BillStatus = "paga" | "atrasada" | "vence_hoje" | "a_vencer";

export function billStatus(due: string, paid: boolean, today: string): BillStatus {
  if (paid) return "paga";
  if (today > due) return "atrasada";
  if (today === due) return "vence_hoje";
  return "a_vencer";
}

/**
 * Lançamentos do extrato que provavelmente pagaram a conta:
 * saída, não vinculada a outra conta, até 12 dias antes e 7 depois do vencimento,
 * valor até 25% diferente do esperado. Ordena pelo mais parecido.
 */
export function suggestPayments(expected: number, due: string, txs: Transaction[], linkedIds: Set<string>) {
  const from = addDays(due, -12);
  const to = addDays(due, 7);
  return txs
    .filter((t) => t.amount < 0 && !linkedIds.has(t.id) && t.date >= from && t.date <= to)
    .map((t) => {
      const diff = Math.abs(Math.abs(t.amount) - expected) / expected;
      return { tx: t, diff, score: diff + Math.abs(daysBetween(t.date, due)) / 30 };
    })
    .filter((c) => c.diff <= 0.25)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((c) => c.tx);
}

/* ---------- Metas ---------- */

export function goalProgress(balance: number, target: number, targetDate: string | null, today: string) {
  const saved = Math.max(balance, 0);
  const remaining = Math.max(Math.round((target - saved) * 100) / 100, 0);
  const pct = Math.min(saved / target, 1);
  let monthsLeft: number | null = null;
  let perMonth: number | null = null;
  if (targetDate) {
    const [ty, tm] = targetDate.split("-").map(Number);
    const [cy, cm] = today.split("-").map(Number);
    monthsLeft = Math.max((ty - cy) * 12 + (tm - cm), 0);
    perMonth = remaining === 0 ? 0 : Math.ceil((remaining / Math.max(monthsLeft, 1)) * 100) / 100;
  }
  return { saved, remaining, pct, monthsLeft, perMonth };
}
