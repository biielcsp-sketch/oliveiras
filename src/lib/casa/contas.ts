/**
 * Contas fixas da casa (fin_bills.is_home). Só COMBINA as regras das Finanças (billForMonth, billStatus):
 * valor e vencimento do boleto do mês valem quando houver; o status sai de billStatus.
 */
import { billForMonth } from "@/lib/financas/documentos/rules";
import { billStatus, type BillStatus } from "@/lib/financas/planning";

export type HomeBillStatus = "paga" | "em_aberto" | "atrasada";
export const HOME_STATUS_LABEL: Record<HomeBillStatus, string> = { paga: "Paga", em_aberto: "Em aberto", atrasada: "Atrasada" };

export const homeStatus = (s: BillStatus): HomeBillStatus => (s === "paga" ? "paga" : s === "atrasada" ? "atrasada" : "em_aberto");

type BillLike = { id: string; name: string; amount: number; due_day: number; active: boolean; is_home?: boolean };
type PaymentLike = { bill_id: string; amount: number; paid_on: string };
type DocLike = { id: string; amount: number | null; due_date: string | null; file_mime: string };

export type HomeBillRow = {
  id: string;
  name: string;
  amount: number;
  due: string;
  status: HomeBillStatus;
  paidOn: string | null;
  doc: { id: string; mime: string } | null;
  suggestions: number;
};

/** Contas da casa no mês: ativas, ou pausadas que foram pagas no mês (mesma regra da tela de Contas fixas). */
export function homeBillsForMonth(o: {
  bills: BillLike[];
  payments: PaymentLike[];
  docs: Map<string, DocLike>;
  suggestionBillIds?: string[];
  month: string;
  today: string;
}): HomeBillRow[] {
  const paid = new Map(o.payments.map((p) => [p.bill_id, p]));
  const sugg = new Map<string, number>();
  for (const id of o.suggestionBillIds ?? []) sugg.set(id, (sugg.get(id) ?? 0) + 1);
  return o.bills
    .filter((b) => b.is_home && (b.active || paid.has(b.id)))
    .map((b) => {
      const doc = o.docs.get(b.id);
      const { amount, due } = billForMonth(b, o.month, doc);
      const payment = paid.get(b.id);
      return {
        id: b.id,
        name: b.name,
        amount: payment?.amount ?? amount,
        due,
        status: homeStatus(billStatus(due, Boolean(payment), o.today)),
        paidOn: payment?.paid_on ?? null,
        doc: doc ? { id: doc.id, mime: doc.file_mime } : null,
        suggestions: payment ? 0 : (sugg.get(b.id) ?? 0),
      };
    })
    .sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name, "pt-BR"));
}

export function homeBillCounts(rows: HomeBillRow[]) {
  return { open: rows.filter((r) => r.status === "em_aberto").length, late: rows.filter((r) => r.status === "atrasada").length };
}
