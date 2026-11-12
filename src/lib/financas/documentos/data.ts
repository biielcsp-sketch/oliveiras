import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import type { DocRef, DocStatus } from "./rules";
import type { DocKind } from "./schema";

export type FinDocument = {
  id: string;
  file_path: string;
  kind: DocKind;
  status: DocStatus;
  file_mime: "application/pdf" | "image/jpeg";
  file_size: number;
  extracted: unknown;
  payee: string | null;
  amount: number | null;
  due_date: string | null;
  paid_on: string | null;
  barcode: string | null;
  bill_id: string | null;
  transaction_id: string | null;
  bill_month: string | null;
  one_off_bill_id: string | null;
  created_at: string;
};

export const DOC_COLS =
  "id, file_path, kind, status, file_mime, file_size, extracted, payee, amount, due_date, paid_on, barcode, bill_id, transaction_id, bill_month, one_off_bill_id, created_at";
const LIST_COLS = "id, kind, status, file_mime, payee, amount, due_date, paid_on, barcode, bill_id, transaction_id, bill_month, one_off_bill_id, created_at";

export type DocListItem = Omit<FinDocument, "extracted" | "file_size" | "file_path">;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Documentos recentes da família (RLS + filtro explícito pelo household do servidor). */
export async function getRecentDocuments(limit = 30): Promise<DocListItem[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_documents")
    .select(LIST_COLS)
    .eq("household_id", household.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((d) => ({ ...d, amount: num(d.amount) })) as DocListItem[];
}

export async function getDocument(id: string): Promise<FinDocument | null> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase.from("fin_documents").select(DOC_COLS).eq("household_id", household.id).eq("id", id).maybeSingle();
  return data ? ({ ...data, amount: num(data.amount), file_size: Number(data.file_size) } as FinDocument) : null;
}

/** Documentos com o mesmo código ou da mesma conta: base dos avisos de duplicidade. */
export async function getRelatedDocs(barcode: string | null, billIds: string[]): Promise<DocRef[]> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const cols = "id, kind, status, barcode, bill_id, bill_month, one_off_bill_id";
  const [byCode, byBill] = await Promise.all([
    barcode
      ? supabase.from("fin_documents").select(cols).eq("household_id", household.id).eq("barcode", barcode).limit(50)
      : Promise.resolve({ data: [] }),
    billIds.length
      ? supabase.from("fin_documents").select(cols).eq("household_id", household.id).eq("status", "confirmado").in("bill_id", billIds).limit(500)
      : Promise.resolve({ data: [] }),
  ]);
  const map = new Map<string, DocRef>();
  for (const d of [...(byCode.data ?? []), ...(byBill.data ?? [])] as DocRef[]) map.set(d.id, d);
  return [...map.values()];
}

export type BillMonthDoc = { id: string; bill_id: string; amount: number | null; due_date: string | null; file_mime: string };

/** Boletos confirmados do mês, um por conta (só status 'confirmado'; o substituído vira 'descartado'). */
export async function getConfirmedBillDocs(month: string): Promise<Map<string, BillMonthDoc>> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_documents")
    .select("id, bill_id, amount, due_date, file_mime")
    .eq("household_id", household.id)
    .eq("status", "confirmado")
    .eq("kind", "boleto")
    .eq("bill_month", month)
    .not("bill_id", "is", null)
    .order("updated_at", { ascending: false });
  const map = new Map<string, BillMonthDoc>();
  for (const d of data ?? []) if (d.bill_id && !map.has(d.bill_id)) map.set(d.bill_id, { ...d, bill_id: d.bill_id, amount: num(d.amount) });
  return map;
}

/** Quantos documentos esperam conferência. */
export async function countPendingDocuments(): Promise<number> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { count } = await supabase
    .from("fin_documents")
    .select("id", { count: "exact", head: true })
    .eq("household_id", household.id)
    .eq("status", "pendente");
  return count ?? 0;
}

/** Documento (não descartado) que originou o lançamento, se houver. */
export async function getDocumentForTransaction(transactionId: string): Promise<{ id: string; file_mime: string } | null> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("fin_documents")
    .select("id, file_mime")
    .eq("household_id", household.id)
    .eq("transaction_id", transactionId)
    .neq("status", "descartado")
    .limit(1)
    .maybeSingle();
  return data;
}
