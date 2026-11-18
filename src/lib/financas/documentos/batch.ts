/**
 * Lote: vários documentos lidos do mesmo arquivo (um PDF com vários boletos). Funções puras.
 * Mesmos avisos de duplicidade da conferência (código de barras já cadastrado), mais o código repetido
 * dentro do próprio arquivo (a coluna barcode só é gravada na confirmação, então o banco ainda não vê).
 */
import { todaySP } from "@/lib/financas/today";
import { reconcile, storedExtracted, type DocKind } from "./schema";
import { sameBarcodeDocs, type DocRef, type DocStatus } from "./rules";

export type BatchDoc = {
  id: string;
  kind: DocKind;
  status: DocStatus;
  payee: string | null;
  amount: number | null;
  due_date: string | null;
  paid_on: string | null;
  barcode: string | null;
  extracted: unknown;
  created_at: string;
};

export type BatchCard = {
  id: string;
  kind: DocKind;
  status: DocStatus;
  payee: string | null;
  amount: number | null;
  due_date: string | null;
  paid_on: string | null;
  /** Aviso de duplicidade (texto fixo do app, nunca texto do documento). */
  aviso: string | null;
};

export const DUP_REGISTERED = "Já existe um documento com o mesmo código de barras.";
export const DUP_IN_FILE = "Código de barras repetido neste arquivo.";

/** Código do documento: o confirmado, ou o lido (forma canônica quando passa nos dígitos). */
export function batchBarcode(d: BatchDoc): string | null {
  if (d.barcode) return d.barcode;
  const ex = storedExtracted(d.extracted);
  return ex ? reconcile(ex, todaySP(new Date(d.created_at))).codigo : null;
}

/** Cards do lote e quantos já foram conferidos (confirmado ou descartado). */
export function batchCards(docs: BatchDoc[], related: DocRef[]): { cards: BatchCard[]; done: number; total: number } {
  const codes = new Map(docs.map((d) => [d.id, batchBarcode(d)]));
  const cards = docs.map((d) => {
    const code = codes.get(d.id) ?? null;
    let aviso: string | null = null;
    if (d.status === "pendente" && code) {
      const kind = d.kind === "comprovante" ? "comprovante" : "boleto";
      const outside = sameBarcodeDocs({ id: d.id, barcode: code }, kind, related);
      const repeated = docs.some((o) => o.id !== d.id && o.status !== "descartado" && codes.get(o.id) === code);
      aviso = outside.length ? DUP_REGISTERED : repeated ? DUP_IN_FILE : null;
    }
    return { id: d.id, kind: d.kind, status: d.status, payee: d.payee, amount: d.amount, due_date: d.due_date, paid_on: d.paid_on, aviso };
  });
  return { cards, done: docs.filter((d) => d.status !== "pendente").length, total: docs.length };
}

/** Códigos dos pendentes (para buscar duplicados no banco numa consulta só). */
export const batchCodes = (docs: BatchDoc[]) =>
  [...new Set(docs.filter((d) => d.status === "pendente").map(batchBarcode).filter((c): c is string => Boolean(c)))];
