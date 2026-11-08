/**
 * Validação de lançamento manual, usada pelo formulário de Finanças e pelo Oli.
 * Mesmas regras e mensagens nos dois caminhos.
 */
export const MAX_AMOUNT = 10_000_000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(v: string) {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

export const optUuid = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null);

export type ManualTransactionInput = {
  accountId: string | null | undefined;
  description: string;
  /** Valor já convertido para número (ou null se inválido). */
  value: number | null;
  date: string;
  direction: "entrada" | "saida" | string;
  categoryId?: string | null;
  memberId?: string | null;
  notes?: string | null;
};

export function validateManualTransaction(input: ManualTransactionInput) {
  const accountId = optUuid(input.accountId);
  const description = input.description.trim();
  const value = input.value;
  if (!accountId) return { error: "Escolha a conta." } as const;
  if (!description || description.length > 200) return { error: "Descreva o lançamento (até 200 letras)." } as const;
  if (value === null || !Number.isFinite(value) || value === 0 || Math.abs(value) > MAX_AMOUNT)
    return { error: "Valor inválido." } as const;
  if (!validDate(input.date)) return { error: "Data inválida." } as const;

  const cents = Math.round(Math.abs(value) * 100) / 100;
  const amount = input.direction === "entrada" ? cents : -cents;
  return {
    data: {
      account_id: accountId,
      date: input.date,
      description,
      amount,
      category_id: optUuid(input.categoryId),
      member_id: optUuid(input.memberId),
      notes: (input.notes ?? "").trim().slice(0, 500) || null,
    },
  } as const;
}
