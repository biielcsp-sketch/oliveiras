import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isLabCategory } from "./catalog";
import type { LabReport, LabResult } from "./summary";

type Db = Awaited<ReturnType<typeof createClient>>;

const REPORT_COLS = "id, member_id, collected_on, lab, file_mime, file_size, created_at";
const RESULT_COLS = "id, report_id, member_id, biomarker_key, name, category, value_num, value_text, unit, ref_min, ref_max, ref_text";
const PAGE = 1000;
/** Teto de segurança de linhas de resultado lidas (10 páginas). */
const MAX_PAGES = 10;
const MAX_REPORTS = 300;

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toReport(r: Record<string, unknown>): LabReport {
  return {
    id: r.id as string,
    member_id: r.member_id as string,
    collected_on: r.collected_on as string,
    lab: (r.lab as string | null) ?? null,
    file_mime: (r.file_mime as LabReport["file_mime"]) ?? null,
    file_size: numOrNull(r.file_size),
    created_at: r.created_at as string | undefined,
  };
}

function toResult(r: Record<string, unknown>): LabResult {
  return {
    id: r.id as string,
    report_id: r.report_id as string,
    member_id: r.member_id as string,
    biomarker_key: r.biomarker_key as string,
    name: r.name as string,
    category: isLabCategory(r.category) ? r.category : "outros",
    value_num: numOrNull(r.value_num),
    value_text: (r.value_text as string | null) ?? null,
    unit: (r.unit as string | null) ?? null,
    ref_min: numOrNull(r.ref_min),
    ref_max: numOrNull(r.ref_max),
    ref_text: (r.ref_text as string | null) ?? null,
  };
}

/** Coletas da família (RLS da sessão), da mais recente para a mais antiga. */
export async function loadLabReports(db: Db, householdId: string): Promise<LabReport[]> {
  const { data } = await db
    .from("health_lab_reports")
    .select(REPORT_COLS)
    .eq("household_id", householdId)
    .order("collected_on", { ascending: false })
    .limit(MAX_REPORTS);
  return ((data ?? []) as Record<string, unknown>[]).map(toReport);
}

/** Resultados da família (RLS da sessão), paginando; `reportIds`/`memberId`/`key` restringem. */
export async function loadLabResults(db: Db, householdId: string, opts: { reportIds?: string[]; memberId?: string; key?: string } = {}): Promise<LabResult[]> {
  if (opts.reportIds && opts.reportIds.length === 0) return [];
  const out: LabResult[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = db.from("health_lab_results").select(RESULT_COLS).eq("household_id", householdId);
    if (opts.reportIds) q = q.in("report_id", opts.reportIds);
    if (opts.memberId) q = q.eq("member_id", opts.memberId);
    if (opts.key) q = q.eq("biomarker_key", opts.key);
    const { data, error } = await q.order("id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error("exames de laboratório: consulta falhou");
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows.map(toResult));
    if (rows.length < PAGE) break;
  }
  return out;
}
