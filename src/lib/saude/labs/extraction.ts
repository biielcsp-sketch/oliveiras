/**
 * Exames de laboratório: validação ESTRITA do que a IA leu do PDF/foto e preparo da lista para conferência.
 * Funções puras (servidor e navegador). Tudo que vem do arquivo é DADO não confiável (pode ter texto malicioso, a
 * "prompt injection"): só passam os campos do schema, cada um no formato certo; qualquer campo extra é descartado e
 * texto longo demais (que parece frase, não resultado de exame) derruba a linha. Nada daqui grava.
 */
import { cleanText } from "@/lib/financas/documentos/schema";
import { isDate } from "@/lib/agenda/dates";
import { detectFileKind, type FileKind } from "@/lib/saude/files";
import { normalizeBiomarker, type LabCategory } from "./catalog";

export const LAB_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const LAB_MAX_RESULTS = 200;
export const LAB_LIMITS = { name: 120, valueText: 40, unit: 30, refText: 120, lab: 120, number: 1e9 } as const;

export type ExtractedResult = {
  name: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  ref_min: number | null;
  ref_max: number | null;
  ref_text: string | null;
};
export type LabExtraction = { collected_on: string | null; lab: string | null; results: ExtractedResult[]; truncated: boolean };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LAB_LIMITS.number ? v : null);

/** Data AAAA-MM-DD real, de 1990 até `today` (coleta no futuro não existe). */
export function cleanCollectedOn(v: unknown, today: string): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return isDate(t) && t >= "1990-01-01" && t <= today ? t : null;
}

/** Valida a resposta da IA (texto JSON). null = inutilizável (JSON ruim, formato errado ou nenhum resultado válido). */
export function parseLabExtraction(text: unknown, today: string): LabExtraction | null {
  if (typeof text !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.resultados)) return null;
  const results: ExtractedResult[] = [];
  for (const item of o.resultados) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    // nome: uma linha curta. Frase longa não é nome de exame.
    if (typeof r.nome !== "string" || r.nome.trim().length > LAB_LIMITS.name) continue;
    const name = cleanText(r.nome, LAB_LIMITS.name);
    if (!name) continue;
    const value_num = num(r.valor);
    let value_text: string | null = null;
    if (value_num === null) {
      if (typeof r.valor_texto !== "string" || r.valor_texto.trim().length > LAB_LIMITS.valueText) continue;
      value_text = cleanText(r.valor_texto, LAB_LIMITS.valueText);
      if (!value_text) continue;
    }
    let ref_min = num(r.ref_min);
    let ref_max = num(r.ref_max);
    if (ref_min !== null && ref_max !== null && ref_min > ref_max) {
      ref_min = null;
      ref_max = null;
    }
    const refTextRaw = typeof r.ref_texto === "string" && r.ref_texto.trim().length <= LAB_LIMITS.refText ? r.ref_texto : null;
    const unitRaw = typeof r.unidade === "string" && r.unidade.trim().length <= LAB_LIMITS.unit ? r.unidade : null;
    results.push({
      name,
      value_num,
      value_text,
      unit: cleanText(unitRaw, LAB_LIMITS.unit),
      ref_min,
      ref_max,
      ref_text: cleanText(refTextRaw, LAB_LIMITS.refText),
    });
  }
  if (results.length === 0) return null;
  const truncated = results.length > LAB_MAX_RESULTS;
  return {
    collected_on: cleanCollectedOn(o.data_coleta, today),
    lab: cleanText(typeof o.laboratorio === "string" && o.laboratorio.trim().length <= LAB_LIMITS.lab ? o.laboratorio : null, LAB_LIMITS.lab),
    results: results.slice(0, LAB_MAX_RESULTS),
    truncated,
  };
}

/* ---------- Lista para conferir ---------- */

/** Linha da tela de conferência: tudo como texto, porque a pessoa pode corrigir. `key` é só da tela. */
export type DraftRow = {
  key: string;
  biomarker_key: string;
  name: string;
  category: LabCategory;
  value: string;
  unit: string;
  ref_min: string;
  ref_max: string;
  ref_text: string;
};

/** Número como o app mostra e aceita (vírgula decimal): "1,234" nunca vira milhar na volta. */
const str = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

/**
 * Normaliza os nomes pelo catálogo (chave + categoria). Duas linhas com a mesma chave não podem coexistir no
 * relatório (índice único): a repetida ganha sufixo "-2", "-3"... e a pessoa decide na conferência.
 */
export function toDraftRows(results: ExtractedResult[]): DraftRow[] {
  const used = new Map<string, number>();
  const rows: DraftRow[] = [];
  results.forEach((r, i) => {
    const n = normalizeBiomarker(r.name);
    if (!n) return;
    const seen = used.get(n.key) ?? 0;
    used.set(n.key, seen + 1);
    const suffix = seen === 0 ? "" : `-${seen + 1}`;
    rows.push({
      key: `r${i}`,
      biomarker_key: `${n.key.slice(0, 80 - suffix.length)}${suffix}`,
      // Exame do catálogo mostra o nome padrão; fora do catálogo mantém o que está no laudo.
      name: n.known ? n.name : r.name,
      category: n.category,
      value: r.value_num !== null ? str(r.value_num) : (r.value_text ?? ""),
      unit: r.unit ?? "",
      ref_min: str(r.ref_min),
      ref_max: str(r.ref_max),
      ref_text: r.ref_text ?? "",
    });
  });
  return rows;
}

/** Bytes do upload: tipo pelos bytes mágicos (nunca pelo mime/nome do navegador), até 5 MB. */
export function checkLabUpload(bytes: Uint8Array): { ok: true; kind: FileKind } | { ok: false; erro: string } {
  if (bytes.length === 0) return { ok: false, erro: "O arquivo está vazio." };
  if (bytes.length > LAB_MAX_FILE_BYTES) return { ok: false, erro: "O arquivo passa de 5 MB." };
  const kind = detectFileKind(bytes);
  if (!kind) return { ok: false, erro: "Envie um arquivo PDF ou JPG." };
  return { ok: true, kind };
}
