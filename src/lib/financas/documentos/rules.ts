/**
 * Regras puras dos documentos de Finanças: caminho no bucket, limite diário,
 * sugestão de conta fixa pelo beneficiário e avisos de duplicidade.
 */
import { normalizeName } from "@/lib/oli/tool-args";
import type { DocKind } from "./schema";
import { dateInMonth } from "@/lib/financas/planning";

export const DOC_BUCKET = "financas";
export const DAILY_DOC_LIMIT = 30;
export const DOC_STATUSES = ["pendente", "confirmado", "descartado"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const DOC_PATH_RE = new RegExp(`^${UUID}/docs/${UUID}\\.(pdf|jpg)$`, "i");

/** Caminho no bucket `financas`: {household_id}/docs/{uuid}.{pdf|jpg}. O nome vem do servidor. */
export function docStoragePath(householdId: string, id: string, ext: "pdf" | "jpg") {
  return `${householdId}/docs/${id}.${ext}`;
}

export const isDocPath = (v: unknown): v is string => typeof v === "string" && DOC_PATH_RE.test(v);

/** Início do dia de hoje em São Paulo, como instante ISO (o Brasil não tem horário de verão desde 2019: UTC−3). */
export function spDayStartIso(todaySp: string) {
  return new Date(`${todaySp}T00:00:00-03:00`).toISOString();
}

export function dailyLimitError(countToday: number, limit = DAILY_DOC_LIMIT) {
  return countToday >= limit
    ? `Limite de ${limit} documentos por dia atingido. Amanhã você pode enviar mais; hoje dá para lançar à mão.`
    : null;
}

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "ltda", "sa", "s/a", "me", "eireli", "cia", "companhia", "the"]);

function tokens(s: string) {
  return normalizeName(s)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Semelhança 0..1 entre o beneficiário e o nome da conta (palavras em comum; nome contido no outro vale 1). */
export function nameSimilarity(payee: string, billName: string) {
  const a = normalizeName(payee);
  const b = normalizeName(billName);
  if (!a || !b) return 0;
  if (b.length >= 3 && (a.includes(b) || b.includes(a))) return 1;
  const tb = tokens(billName);
  if (tb.length === 0) return 0;
  const ta = new Set(tokens(payee));
  return tb.filter((t) => ta.has(t)).length / tb.length;
}

/** Conta fixa mais parecida com o beneficiário (mínimo 0,5); null se nenhuma. */
export function suggestBill<T extends { id: string; name: string }>(payee: string | null, bills: T[]): T | null {
  if (!payee) return null;
  let best: { bill: T; score: number } | null = null;
  for (const bill of bills) {
    const score = nameSimilarity(payee, bill.name);
    if (score >= 0.5 && (!best || score > best.score)) best = { bill, score };
  }
  return best?.bill ?? null;
}

export type DocRef = { id: string; kind: DocKind; status: DocStatus; barcode: string | null; bill_id: string | null; bill_month: string | null };

/** Outros documentos (não descartados) da família com o mesmo código e do mesmo tipo. */
export function sameBarcodeDocs(current: { id: string; barcode: string | null }, kind: DocKind, others: DocRef[]) {
  if (!current.barcode) return [];
  return others.filter((o) => o.id !== current.id && o.status !== "descartado" && o.barcode === current.barcode && o.kind === kind);
}

/** Outro boleto já confirmado para a mesma conta no mesmo mês. */
export function sameBillMonthDocs(currentId: string, billId: string | null, month: string | null, others: DocRef[]) {
  if (!billId || !month) return [];
  return others.filter(
    (o) => o.id !== currentId && o.status === "confirmado" && o.kind === "boleto" && o.bill_id === billId && o.bill_month === month,
  );
}

/** Mês (AAAA-MM) da data, ou null. */
export const monthOf = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(0, 7) : null);

export const KIND_LABEL: Record<DocKind, string> = { boleto: "Boleto", comprovante: "Comprovante", outro: "Outro" };
export const STATUS_LABEL: Record<DocStatus, string> = { pendente: "Pendente", confirmado: "Confirmado", descartado: "Descartado" };

/** Pendentes primeiro; dentro de cada grupo, os mais recentes primeiro. */
export function sortDocs<T extends { status: DocStatus; created_at: string }>(docs: T[]) {
  return [...docs].sort((a, b) =>
    a.status === "pendente" && b.status !== "pendente"
      ? -1
      : b.status === "pendente" && a.status !== "pendente"
        ? 1
        : b.created_at.localeCompare(a.created_at),
  );
}

/**
 * Valor e vencimento da conta fixa num mês: o boleto confirmado daquele mês prevalece;
 * sem boleto, vale o valor fixo e o dia de vencimento da conta. O valor fixo nunca muda.
 */
export function billForMonth(
  bill: { amount: number; due_day: number },
  month: string,
  doc?: { amount: number | null; due_date: string | null } | null,
) {
  return {
    amount: doc?.amount ?? bill.amount,
    due: doc?.due_date ?? dateInMonth(month, bill.due_day),
  };
}
