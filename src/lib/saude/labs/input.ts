/**
 * Exames de laboratório: validação do que o navegador manda no "Confirmar e salvar". O navegador é não confiável:
 * tudo é conferido de novo aqui (formato, tamanhos, categoria, chave) antes de qualquer gravação.
 */
import { cleanText } from "@/lib/financas/documentos/schema";
import { isLabCategory, slugify, type LabCategory } from "./catalog";
import { cleanCollectedOn, LAB_LIMITS, LAB_MAX_RESULTS, type DraftRow } from "./extraction";

export type ResultInsert = {
  biomarker_key: string;
  name: string;
  category: LabCategory;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  ref_min: number | null;
  ref_max: number | null;
  ref_text: string | null;
};
export type LabSaveInput = { collected_on: string; lab: string | null; results: ResultInsert[] };

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "82", "0,8", "1.234,5" → número (ponto + exatamente 3 dígitos = milhar; a conferência mostra números com vírgula, então não há ambiguidade); qualquer outra coisa (ex.: "Negativo", "< 0,5") fica como texto. */
export function parseNumberInput(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  let s: string;
  // Padrão BR: ponto é milhar quando há vírgula decimal ("1.234,5") ou quando são exatamente 3 dígitos após o ponto
  // e nenhum outro separador ("250.000" = 250000). "2.5" e "0.500" continuam decimais.
  if (/^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) s = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+(?:[.,]\d+)?$/.test(t)) s = t.replace(",", ".");
  else return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= LAB_LIMITS.number ? n : null;
}

/** Limite de referência opcional: vazio → null; algo que não é número → erro. */
function optBound(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return { ok: true, value: null };
  const n = parseNumberInput(v);
  return n === null ? { ok: false } : { ok: true, value: n };
}

const BAD = (erro: string) => ({ ok: false as const, erro });

export function validateLabSave(raw: { collected_on: unknown; lab: unknown; rows: unknown }, today: string): { ok: true; value: LabSaveInput } | { ok: false; erro: string } {
  const collected_on = cleanCollectedOn(raw.collected_on, today);
  if (!collected_on) return BAD("Informe a data da coleta (não pode ser futura).");
  if (raw.lab !== undefined && raw.lab !== null && typeof raw.lab !== "string") return BAD("Laboratório inválido.");
  const labRaw = typeof raw.lab === "string" ? raw.lab.trim() : "";
  if (labRaw.length > LAB_LIMITS.lab) return BAD(`Laboratório: máximo de ${LAB_LIMITS.lab} letras.`);
  if (!Array.isArray(raw.rows) || raw.rows.length === 0) return BAD("Não há resultados para salvar.");
  if (raw.rows.length > LAB_MAX_RESULTS) return BAD(`No máximo ${LAB_MAX_RESULTS} resultados por coleta.`);

  const seen = new Set<string>();
  const results: ResultInsert[] = [];
  for (const item of raw.rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return BAD("Resultado inválido.");
    const r = item as Partial<Record<keyof DraftRow, unknown>>;
    const name = typeof r.name === "string" && r.name.trim().length <= LAB_LIMITS.name ? cleanText(r.name, LAB_LIMITS.name) : null;
    if (!name) return BAD(`Cada resultado precisa de um nome (até ${LAB_LIMITS.name} letras).`);
    const key = typeof r.biomarker_key === "string" && KEY_RE.test(r.biomarker_key) && r.biomarker_key.length <= 80 ? r.biomarker_key : slugify(name);
    if (!key || !KEY_RE.test(key)) return BAD(`O exame “${name}” tem um nome inválido.`);
    if (seen.has(key)) return BAD(`O exame “${name}” aparece duas vezes. Remova uma das linhas.`);
    seen.add(key);
    const category = isLabCategory(r.category) ? r.category : "outros";
    const valueRaw = typeof r.value === "string" ? r.value.trim() : "";
    if (!valueRaw) return BAD(`O exame “${name}” está sem valor. Preencha ou remova a linha.`);
    const value_num = parseNumberInput(valueRaw);
    const value_text = value_num === null ? cleanText(valueRaw, LAB_LIMITS.valueText) : null;
    if (value_num === null && (valueRaw.length > LAB_LIMITS.valueText || !value_text)) return BAD(`O valor de “${name}” é longo demais.`);
    const min = optBound(r.ref_min);
    const max = optBound(r.ref_max);
    if (!min.ok || !max.ok) return BAD(`A referência de “${name}” precisa ser número.`);
    if (min.value !== null && max.value !== null && min.value > max.value) return BAD(`A referência de “${name}”: o mínimo passa do máximo.`);
    const unitRaw = typeof r.unit === "string" ? r.unit.trim() : "";
    if (unitRaw.length > LAB_LIMITS.unit) return BAD(`A unidade de “${name}” é longa demais.`);
    const refRaw = typeof r.ref_text === "string" ? r.ref_text.trim() : "";
    if (refRaw.length > LAB_LIMITS.refText) return BAD(`A referência de “${name}” é longa demais.`);
    results.push({
      biomarker_key: key,
      name,
      category,
      value_num,
      value_text,
      unit: cleanText(unitRaw, LAB_LIMITS.unit),
      ref_min: min.value,
      ref_max: max.value,
      ref_text: cleanText(refRaw, LAB_LIMITS.refText),
    });
  }
  return { ok: true, value: { collected_on, lab: cleanText(labRaw, LAB_LIMITS.lab), results } };
}

/** Mesmo laboratório para a trava de duplicidade: sem caixa nem espaços nas pontas; vazio só é igual a vazio. */
export const sameLab = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
