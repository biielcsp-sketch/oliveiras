/** Documentos e garantias da Casa (funções puras). Datas "AAAA-MM-DD" de São Paulo. */
import { diffDays } from "@/lib/agenda/dates";

export const CASA_BUCKET = "casa";
export const WARRANTY_SOON_DAYS = 30;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Caminho no bucket `casa`: {household_id}/docs/{uuid}.{pdf|jpg}. O nome vem sempre do servidor. */
export const CASA_DOC_PATH_RE = new RegExp(`^${UUID}/docs/${UUID}\\.(pdf|jpg)$`, "i");
export const casaDocPath = (householdId: string, id: string, ext: "pdf" | "jpg") => `${householdId}/docs/${id}.${ext}`;
export const isCasaDocPath = (v: unknown): v is string => typeof v === "string" && CASA_DOC_PATH_RE.test(v);

export type WarrantyStatus = "vencida" | "vencendo" | "valida";

/** Vencida: antes de hoje. Vencendo: de hoje até 30 dias. Sem data: null. */
export function warrantyStatus(until: string | null, today: string): WarrantyStatus | null {
  if (!until) return null;
  const days = diffDays(today, until);
  if (days < 0) return "vencida";
  if (days <= WARRANTY_SOON_DAYS) return "vencendo";
  return "valida";
}

/** Garantias em destaque (vencendo primeiro pela data, depois as vencidas mais recentes). */
export function warrantyAlerts<T extends { warranty_until: string | null }>(docs: T[], today: string) {
  const soon = docs.filter((d) => warrantyStatus(d.warranty_until, today) === "vencendo").sort((a, b) => a.warranty_until!.localeCompare(b.warranty_until!));
  const expired = docs.filter((d) => warrantyStatus(d.warranty_until, today) === "vencida").sort((a, b) => b.warranty_until!.localeCompare(a.warranty_until!));
  return { soon, expired };
}
