import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { toSpDate } from "@/lib/agenda/dates";
import { DOCUMENT_COLS, num, type CasaDocument } from "@/lib/casa/types";
import { DocumentsView, type DocumentVM } from "../_components/documents-view";

export const metadata = { title: "Documentos · Casa" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("casa_documents").select(DOCUMENT_COLS).eq("household_id", ctx.household.id).order("created_at", { ascending: false }).limit(500);
  const docs: DocumentVM[] = ((data ?? []) as CasaDocument[]).map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    product: d.product,
    store: d.store,
    purchase_date: d.purchase_date,
    warranty_until: d.warranty_until,
    amount: num(d.amount),
    notes: d.notes,
    mime: d.file_mime,
    size: d.file_size,
  }));
  return <DocumentsView docs={docs} today={toSpDate(new Date())} />;
}
