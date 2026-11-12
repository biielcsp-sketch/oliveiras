/**
 * Contas avulsas (fin_one_off_bills, migração 0021): boleto pago uma vez só, ao lado das contas fixas.
 * Regras puras (sem banco). Quem grava são as ações do servidor, sempre com a sessão do usuário (RLS).
 */
import { parseBRL } from "./money";
import { billStatus, type BillStatus } from "./planning";
import { MAX_AMOUNT, optUuid, validDate } from "./transaction-input";
import { isMonth } from "./documentos/input";

export type OneOffBill = {
  id: string;
  name: string;
  amount: number;
  due_date: string;
  category_id: string | null;
  account_id: string | null;
  is_home: boolean;
  paid_on: string | null;
  transaction_id: string | null;
  paid_auto: boolean;
};

type Fail = { ok: false; erro: string };
const fail = (erro: string): Fail => ({ ok: false, erro });

/** Tipo escolhido na conferência do boleto. Sem padrão: vazio ou qualquer outro valor é recusado. */
export type BillKind = "fixa" | "avulsa";
export function parseBillKind(raw: unknown): BillKind | null {
  return raw === "fixa" || raw === "avulsa" ? raw : null;
}
export const BILL_KIND_REQUIRED = "Escolha o tipo da conta: fixa (todo mês) ou avulsa (só esta vez).";

export type OneOffInput = { name: string; amount: string; dueDate: string };
export type OneOffValues = { name: string; amount: number; due_date: string };

/** Nome (1 a 60 letras), valor (0 < v ≤ 10 milhões) e vencimento válido: os mesmos limites do banco. */
export function validateOneOffInput(f: OneOffInput): { ok: true; value: OneOffValues } | Fail {
  const name = f.name.trim();
  if (!name || name.length > 60) return fail("Dê um nome à conta avulsa (até 60 letras).");
  const amount = parseBRL(f.amount);
  if (amount === null || amount <= 0 || amount > MAX_AMOUNT) return fail("Valor inválido.");
  if (!validDate(f.dueDate)) return fail("Vencimento inválido.");
  return { ok: true, value: { name, amount, due_date: f.dueDate } };
}

/** Status igual ao das fixas: paga, atrasada, vence hoje ou a vencer (pelo vencimento da avulsa). */
export const oneOffStatus = (o: { due_date: string; paid_on: string | null }, today: string): BillStatus =>
  billStatus(o.due_date, Boolean(o.paid_on), today);

/** Avulsas do mês (pelo vencimento), da mais antiga para a mais nova. `onlyHome`: só as da casa. */
export function oneOffsForMonth<T extends { due_date: string; name: string; is_home?: boolean }>(list: T[], month: string, onlyHome = false) {
  return list
    .filter((o) => o.due_date.slice(0, 7) === month && (!onlyHome || o.is_home))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * "Marcar como paga a conta" na conferência do comprovante: vazio (não marca), uma fixa (uuid + mês)
 * ou uma avulsa ("avulsa:<uuid>", sem mês: a avulsa só tem um vencimento).
 */
export type PayTarget = { kind: "fixa"; billId: string; month: string } | { kind: "avulsa"; id: string };
const AVULSA_PREFIX = "avulsa:";
export const oneOffOption = (id: string) => `${AVULSA_PREFIX}${id}`;

export function parsePayTarget(raw: string, month: string): { ok: true; value: PayTarget | null } | Fail {
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  if (v.startsWith(AVULSA_PREFIX)) {
    const id = optUuid(v.slice(AVULSA_PREFIX.length));
    return id ? { ok: true, value: { kind: "avulsa", id } } : fail("Conta avulsa inválida.");
  }
  const id = optUuid(v);
  if (!id) return fail("Conta fixa inválida.");
  if (!isMonth(month)) return fail("Informe o mês da conta paga (AAAA-MM).");
  return { ok: true, value: { kind: "fixa", billId: id, month } };
}

/**
 * Um lançamento paga no máximo UMA conta, fixa ou avulsa. O banco só impede repetição dentro de cada
 * tabela (fin_bill_payments.transaction_id e fin_one_off_bills.transaction_id); entre as duas, quem
 * impede é o app, nas duas direções. `uses`: onde o lançamento já está ligado.
 */
export function txPayConflict(
  target: { kind: "fixa"; billId: string; month: string } | { kind: "avulsa"; id: string },
  uses: { fixed: { bill_id: string; month: string }[]; oneOff: { id: string }[] },
): string | null {
  if (target.kind === "fixa") {
    if (uses.oneOff.length > 0) return "Este lançamento já pagou uma conta avulsa. Desfaça aquele pagamento antes.";
    if (uses.fixed.some((p) => p.bill_id !== target.billId || p.month !== target.month))
      return "Este lançamento já pagou outra conta fixa.";
    return null;
  }
  if (uses.fixed.length > 0) return "Este lançamento já pagou uma conta fixa. Desfaça aquele pagamento antes.";
  if (uses.oneOff.some((o) => o.id !== target.id)) return "Este lançamento já pagou outra conta avulsa.";
  return null;
}

/** Mês (AAAA-MM) de um vencimento válido; para os redirecionamentos depois de salvar. */
export const dueMonth = (due: string) => (isMonth(due.slice(0, 7)) ? due.slice(0, 7) : null);
