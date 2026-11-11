/**
 * Validação (pura) dos formulários de conferência. O servidor chama isto antes de gravar;
 * as regras de lançamento continuam em transaction-input.ts.
 */
import { parseBRL } from "@/lib/financas/money";
import { MAX_AMOUNT, optUuid, validDate } from "@/lib/financas/transaction-input";
import { parseBoleto } from "./boleto";
import { cleanText, DOC_LIMITS } from "./schema";
import { sameBarcodeDocs, sameBillMonthDocs, type DocRef } from "./rules";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH_RE.test(v);

type Fail = { ok: false; erro: string };
const fail = (erro: string): Fail => ({ ok: false, erro });

/** Código opcional: vazio → null; preenchido precisa passar nos dígitos verificadores. Devolve a forma de 44 dígitos. */
export function readBarcode(raw: string, referenceIso: string): { ok: true; value: string | null } | Fail {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  const p = parseBoleto(t, referenceIso);
  if (!p.ok) return fail(`Linha digitável inválida: ${p.erro} Corrija ou apague.`);
  return { ok: true, value: p.info.barras };
}

export type BoletoForm = {
  billChoice: string; // "nova" | uuid
  newName: string;
  newDueDay: string;
  payee: string;
  amount: string;
  dueDate: string;
  billMonth: string;
  barcode: string;
};

export type BoletoValues = {
  bill: { kind: "nova"; name: string; dueDay: number } | { kind: "existente"; id: string };
  payee: string | null;
  amount: number;
  due_date: string;
  bill_month: string;
  barcode: string | null;
};

export function validateBoletoForm(f: BoletoForm, referenceIso: string): { ok: true; value: BoletoValues } | Fail {
  let bill: BoletoValues["bill"];
  if (f.billChoice === "nova") {
    const name = f.newName.trim();
    const dueDay = Number(f.newDueDay);
    if (!name || name.length > 60) return fail("Dê um nome à conta (até 60 letras).");
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return fail("Dia de vencimento entre 1 e 31.");
    bill = { kind: "nova", name, dueDay };
  } else {
    const id = optUuid(f.billChoice);
    if (!id) return fail("Escolha a conta fixa ou crie uma nova.");
    bill = { kind: "existente", id };
  }
  const amount = parseBRL(f.amount);
  if (amount === null || amount <= 0 || amount > MAX_AMOUNT) return fail("Valor inválido.");
  if (!validDate(f.dueDate)) return fail("Vencimento inválido.");
  // Toda ligação com conta precisa do mês: é ele que põe o boleto na conta certa em Contas fixas.
  if (!isMonth(f.billMonth)) return fail("Informe o mês da conta (AAAA-MM).");
  const code = readBarcode(f.barcode, referenceIso);
  if (!code.ok) return code;
  return {
    ok: true,
    value: { bill, payee: cleanText(f.payee, DOC_LIMITS.payee), amount, due_date: f.dueDate, bill_month: f.billMonth, barcode: code.value },
  };
}

/** Marcar conta paga junto do comprovante: conta e mês juntos, ou nenhum. */
export function validatePayLink(billId: string, month: string): { ok: true; value: { billId: string; month: string } | null } | Fail {
  if (!billId.trim()) return { ok: true, value: null };
  const id = optUuid(billId.trim());
  if (!id) return fail("Conta fixa inválida.");
  if (!isMonth(month)) return fail("Informe o mês da conta paga (AAAA-MM).");
  return { ok: true, value: { billId: id, month } };
}

const monthLabelBr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/**
 * Bloqueios de duplicidade na confirmação:
 * - mesmo código e mesmo tipo em outro documento não descartado → nunca confirma como novo;
 * - outro boleto confirmado para a mesma conta e mês → só com "substituir" marcado.
 */
export function duplicateBlock(input: {
  current: { id: string; barcode: string | null };
  kind: "boleto" | "comprovante";
  billId: string | null;
  billMonth: string | null;
  others: DocRef[];
  replaceSameMonth: boolean;
}): string | null {
  if (sameBarcodeDocs(input.current, input.kind, input.others).length > 0)
    return input.kind === "boleto"
      ? "Já existe este boleto em outro documento. Abra o existente ou descarte este."
      : "Já existe este comprovante em outro documento. Abra o existente ou descarte este.";
  if (input.kind === "boleto" && !input.replaceSameMonth && sameBillMonthDocs(input.current.id, input.billId, input.billMonth, input.others).length > 0)
    return `Esta conta já tem um boleto confirmado em ${monthLabelBr(input.billMonth!)}. Marque "Substituir o boleto do mês" para confirmar mesmo assim.`;
  return null;
}

/* ---------- Edição de documento confirmado ---------- */

export type BoletoEditForm = { billId: string; amount: string; dueDate: string; billMonth: string };
export type BoletoEditValues = { bill_id: string; amount: number; due_date: string; bill_month: string };

/** Boleto confirmado: valor, vencimento, conta fixa vinculada e mês de referência (o código não muda). */
export function validateBoletoEdit(f: BoletoEditForm): { ok: true; value: BoletoEditValues } | Fail {
  const billId = optUuid(f.billId.trim());
  if (!billId) return fail("Escolha a conta fixa do boleto.");
  const amount = parseBRL(f.amount);
  if (amount === null || amount <= 0 || amount > MAX_AMOUNT) return fail("Valor inválido.");
  if (!validDate(f.dueDate)) return fail("Vencimento inválido.");
  if (!isMonth(f.billMonth)) return fail("Informe o mês da conta (AAAA-MM).");
  return { ok: true, value: { bill_id: billId, amount, due_date: f.dueDate, bill_month: f.billMonth } };
}

export type ComprovanteEditForm = { amount: string; paidOn: string; payee: string };
export type ComprovanteEditValues = { amount: number; paid_on: string; payee: string | null };

/** Comprovante confirmado: só os dados do documento. O lançamento ligado se edita na tela dele. */
export function validateComprovanteEdit(f: ComprovanteEditForm): { ok: true; value: ComprovanteEditValues } | Fail {
  const amount = parseBRL(f.amount);
  if (amount === null || amount <= 0 || amount > MAX_AMOUNT) return fail("Valor inválido.");
  if (!validDate(f.paidOn)) return fail("Data do pagamento inválida.");
  return { ok: true, value: { amount, paid_on: f.paidOn, payee: cleanText(f.payee, DOC_LIMITS.payee) } };
}

/** Outro boleto confirmado já ocupa a conta+mês escolhidos (índice único do banco). */
export function boletoEditConflict(currentId: string, billId: string, month: string, others: DocRef[]): string | null {
  return sameBillMonthDocs(currentId, billId, month, others).length > 0
    ? `Esta conta já tem outro boleto confirmado em ${monthLabelBr(month)}. Apague ou edite o outro antes.`
    : null;
}

/** Mensagem para erro do banco ao salvar a edição; 23505 = índice único (conta+mês ou código repetido). */
export function editSaveError(code: string | undefined) {
  return code === "23505"
    ? "Não deu para salvar: já existe outro boleto confirmado para esta conta neste mês, ou outro boleto com o mesmo código. Confira os documentos e tente de novo."
    : "Não foi possível salvar. Tente de novo.";
}
