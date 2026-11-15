/**
 * Exames de laboratório: status de cada resultado e tendência entre coletas.
 * Funções puras. A faixa SEMPRE é a do próprio laboratório (ref_min/ref_max/ref_text do resultado):
 * o app não tem faixa própria nem interpreta o exame; só compara o valor com a faixa impressa no laudo.
 */
import { normalizeText } from "./catalog";

export type LabValue = {
  value_num: number | null;
  value_text: string | null;
  ref_min: number | null;
  ref_max: number | null;
  ref_text: string | null;
};

export type LabStatus = "dentro" | "atencao" | "fora" | "sem_faixa";

export const STATUS_LABEL: Record<LabStatus, string> = {
  dentro: "Dentro do padrão",
  atencao: "Atenção",
  fora: "Fora do padrão",
  sem_faixa: "Sem faixa",
};

/** Perto do limite: dentro da faixa, a até 10% da largura dela de um dos limites (só com mínimo e máximo). */
export const ATTENTION_FRACTION = 0.1;
/** Tolerância da tendência: variação de até 2% da largura da faixa conta como estável. */
export const TREND_TOLERANCE = 0.02;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type Range = { min: number | null; max: number | null };

/** Limites numéricos: ref_min/ref_max; sem nenhum, tenta entender ref_text ("até 100", "< 100", "> 40", "40 a 60"). */
export function rangeOf(r: Pick<LabValue, "ref_min" | "ref_max" | "ref_text">): Range {
  const min = finite(r.ref_min) ? r.ref_min : null;
  const max = finite(r.ref_max) ? r.ref_max : null;
  if (min !== null || max !== null) return { min, max };
  return parseRefText(r.ref_text);
}

const NUM = "(\\d+(?:[.,]\\d+)?)";
const toNum = (s: string) => Number(s.replace(",", "."));

/** Faixa escrita em texto. Texto que não seja claramente numérico devolve sem limites. Limites são inclusivos. */
export function parseRefText(text: string | null | undefined): Range {
  const t = normalizeTextKeepSigns(text);
  if (!t) return { min: null, max: null };
  let m = t.match(new RegExp(`^${NUM} (?:a|ate|-) ${NUM}(?: [a-z/%0-9]+)?$`));
  if (m) {
    const [lo, hi] = [toNum(m[1]), toNum(m[2])];
    return lo <= hi ? { min: lo, max: hi } : { min: null, max: null };
  }
  m = t.match(new RegExp(`^(?:<=|<|ate|inferior a|menor que|menor ou igual a|ate no maximo) ?${NUM}(?: [a-z/%0-9]+)?$`));
  if (m) return { min: null, max: toNum(m[1]) };
  m = t.match(new RegExp(`^(?:>=|>|acima de|superior a|maior que|maior ou igual a|a partir de|minimo de) ?${NUM}(?: [a-z/%0-9]+)?$`));
  if (m) return { min: toNum(m[1]), max: null };
  return { min: null, max: null };
}

/** Como normalizeText, mas mantém < > = e vírgula/ponto decimal e o hífen entre números. */
function normalizeTextKeepSigns(v: string | null | undefined): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9<>=.,%/\- ]+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/(<=|>=|<|>)\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(<=|>=|<|>) /, "$1");
}

const NEGATIVE = ["negativo", "negativa", "nao reagente", "ausente", "ausentes", "nao detectado", "nao detectavel", "normal", "inexistente", "nao observado", "nao observada"];
const POSITIVE = ["positivo", "positiva", "reagente", "presente", "presentes", "detectado", "detectavel", "alterado", "alterada"];

/** Texto qualitativo → negativo / positivo / desconhecido (sem acento, sem pontuação final). */
function qualitative(v: string | null | undefined): "neg" | "pos" | null {
  const t = normalizeText(v);
  if (!t) return null;
  if (NEGATIVE.includes(t)) return "neg";
  if (POSITIVE.includes(t)) return "pos";
  return null;
}

/** Distância do valor até a faixa: 0 dentro; senão quanto passou do limite. */
export function distanceToRange(v: number, range: Range): number {
  if (range.min !== null && v < range.min) return range.min - v;
  if (range.max !== null && v > range.max) return v - range.max;
  return 0;
}

export function statusOf(r: LabValue): LabStatus {
  if (finite(r.value_num)) {
    const v = r.value_num;
    const { min, max } = rangeOf(r);
    if (min === null && max === null) return "sem_faixa";
    if (distanceToRange(v, { min, max }) > 0) return "fora";
    if (min !== null && max !== null) {
      const width = max - min;
      if (width > 0 && (v - min <= width * ATTENTION_FRACTION || max - v <= width * ATTENTION_FRACTION)) return "atencao";
    }
    return "dentro";
  }
  // Só texto: compara com a referência escrita (ex.: "Negativo").
  const val = qualitative(r.value_text);
  const ref = qualitative(r.ref_text);
  const sameText = normalizeText(r.value_text) !== "" && normalizeText(r.value_text) === normalizeText(r.ref_text);
  if (sameText) return "dentro";
  if (val && ref) return val === ref ? "dentro" : "fora";
  return "sem_faixa";
}

/** Contagem de status por conjunto de resultados (ignora "sem faixa" no total analisado). */
export type StatusCount = { dentro: number; atencao: number; fora: number; sem_faixa: number; analisados: number };

export function countStatuses(list: LabStatus[]): StatusCount {
  const c: StatusCount = { dentro: 0, atencao: 0, fora: 0, sem_faixa: 0, analisados: 0 };
  for (const s of list) {
    c[s] += 1;
    if (s !== "sem_faixa") c.analisados += 1;
  }
  return c;
}

/** Pior status do conjunto (fora > atenção > dentro); null se nenhum tem faixa. */
export function worstStatus(list: LabStatus[]): Exclude<LabStatus, "sem_faixa"> | null {
  if (list.includes("fora")) return "fora";
  if (list.includes("atencao")) return "atencao";
  if (list.includes("dentro")) return "dentro";
  return null;
}

/* ---------- Tendência ---------- */

export type TrendDir = "melhorou" | "piorou" | "estavel" | "subiu" | "caiu";
export type Trend = {
  dir: TrendDir;
  /** Módulo da diferença entre os valores (atual − anterior). */
  delta: number;
  /** "faixa": medida pela distância até a faixa; "valor": sem faixa, só subiu/caiu. */
  base: "faixa" | "valor";
};

export const TREND_LABEL: Record<TrendDir, string> = {
  melhorou: "Melhorou",
  piorou: "Piorou",
  estavel: "Estável",
  subiu: "Subiu",
  caiu: "Caiu",
};

/**
 * Tendência da coleta atual contra a anterior. Só números têm tendência (texto → null).
 * Com faixa (a do laboratório na coleta atual; na falta, a da anterior): compara a distância até a faixa;
 * mais perto = melhorou, mais longe = piorou, diferença de até 2% da largura = estável. Dentro da faixa nas
 * duas coletas, a distância é 0 nas duas, então é estável. Faixa com um limite só: largura = |limite|.
 * Sem faixa nenhuma: igual = estável; maior = subiu; menor = caiu (sem dizer se é bom ou ruim).
 */
export function trendOf(cur: LabValue, prev: LabValue | null | undefined): Trend | null {
  if (!prev || !finite(cur.value_num) || !finite(prev.value_num)) return null;
  const c = cur.value_num;
  const p = prev.value_num;
  const delta = Math.abs(c - p);
  let range = rangeOf(cur);
  if (range.min === null && range.max === null) range = rangeOf(prev);
  if (range.min === null && range.max === null) {
    return { dir: c === p ? "estavel" : c > p ? "subiu" : "caiu", delta, base: "valor" };
  }
  const width = range.min !== null && range.max !== null ? range.max - range.min : Math.abs((range.min ?? range.max) as number);
  const gain = distanceToRange(p, range) - distanceToRange(c, range); // > 0: chegou mais perto da faixa
  const dir: TrendDir = Math.abs(gain) <= width * TREND_TOLERANCE + 1e-9 ? "estavel" : gain > 0 ? "melhorou" : "piorou";
  return { dir, delta, base: "faixa" };
}

/** Texto curto da faixa para a tela ("70 a 99", "até 100", "a partir de 40"); cai no texto do laudo. */
export function rangeLabel(r: Pick<LabValue, "ref_min" | "ref_max" | "ref_text">, fmt: (n: number) => string = formatNumber): string | null {
  const min = finite(r.ref_min) ? r.ref_min : null;
  const max = finite(r.ref_max) ? r.ref_max : null;
  if (min !== null && max !== null) return `${fmt(min)} a ${fmt(max)}`;
  if (max !== null) return `até ${fmt(max)}`;
  if (min !== null) return `a partir de ${fmt(min)}`;
  const t = typeof r.ref_text === "string" ? r.ref_text.trim() : "";
  return t || null;
}

/** Número em pt-BR sem zeros à toa (até 2 casas). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);
}

/** Valor para mostrar: número formatado ou o texto do laudo. */
export function valueLabel(r: Pick<LabValue, "value_num" | "value_text">): string {
  return finite(r.value_num) ? formatNumber(r.value_num) : (r.value_text ?? "");
}
