/**
 * Exames de laboratório: resumo, evolução, série do gráfico e orientações. Funções puras sobre as linhas do banco
 * (já filtradas pelo RLS da sessão). Nada aqui diagnostica, interpreta clinicamente ou sugere remédio/dose: só compara
 * o resultado com a faixa de referência impressa pelo PRÓPRIO laboratório e conta o que mudou entre coletas.
 */
import { addDays } from "@/lib/agenda/dates";
import { LAB_CATEGORIES, LAB_CATEGORY_LABEL, type LabCategory } from "./catalog";
import {
  countStatuses,
  formatNumber,
  rangeLabel,
  rangeOf,
  statusOf,
  trendOf,
  valueLabel,
  worstStatus,
  type LabStatus,
  type LabValue,
  type StatusCount,
  type Trend,
} from "./status";

export type LabReport = {
  id: string;
  member_id: string;
  collected_on: string;
  lab: string | null;
  file_mime: "application/pdf" | "image/jpeg" | null;
  file_size: number | null;
  created_at?: string;
};

export type LabResult = LabValue & {
  id: string;
  report_id: string;
  member_id: string;
  biomarker_key: string;
  name: string;
  category: LabCategory;
  unit: string | null;
};

export const ORIENTATION_NOTICE = "Orientação geral, calculada a partir das faixas de referência do seu laboratório. Não substitui consulta médica.";

/** "2026-05-07" → "05/26". */
export const monthYearShort = (date: string) => `${date.slice(5, 7)}/${date.slice(2, 4)}`;
/** "2026-05-07" → "05/2026". */
export const monthYear = (date: string) => `${date.slice(5, 7)}/${date.slice(0, 4)}`;

/* ---------- Índice por pessoa ---------- */

export type Point = { report: LabReport; result: LabResult };
type MemberIndex = { reports: LabReport[]; byKey: Map<string, Point[]> };

const byDate = (a: LabReport, b: LabReport) => a.collected_on.localeCompare(b.collected_on) || (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id);

/** Relatórios e resultados por pessoa, do mais antigo para o mais novo. Resultado sem relatório conhecido é ignorado. */
export function indexByMember(reports: LabReport[], results: LabResult[]): Map<string, MemberIndex> {
  const out = new Map<string, MemberIndex>();
  const rep = new Map(reports.map((r) => [r.id, r]));
  for (const r of [...reports].sort(byDate)) {
    if (!out.has(r.member_id)) out.set(r.member_id, { reports: [], byKey: new Map() });
    out.get(r.member_id)!.reports.push(r);
  }
  const order = new Map([...reports].sort(byDate).map((r, i) => [r.id, i]));
  for (const res of [...results].sort((a, b) => (order.get(a.report_id) ?? 0) - (order.get(b.report_id) ?? 0))) {
    const report = rep.get(res.report_id);
    if (!report || report.member_id !== res.member_id) continue;
    const idx = out.get(report.member_id)!;
    const list = idx.byKey.get(res.biomarker_key) ?? [];
    list.push({ report, result: res });
    idx.byKey.set(res.biomarker_key, list);
  }
  return out;
}

const lastOf = <T,>(a: T[]): T | undefined => a[a.length - 1];

/** Resultado mais recente de cada exame da pessoa, com o anterior (para a tendência). */
function latestPerBiomarker(idx: MemberIndex) {
  const out: { cur: Point; prev: Point | null }[] = [];
  for (const list of idx.byKey.values()) {
    const cur = lastOf(list)!;
    out.push({ cur, prev: list.length > 1 ? list[list.length - 2] : null });
  }
  return out;
}

/* ---------- Resumo ---------- */

export type SummaryCategory = { category: LabCategory; label: string; status: Exclude<LabStatus, "sem_faixa"> | null; total: number };
export type LabSummary = {
  /** Data da coleta mais recente entre os relatórios considerados. */
  collectedOn: string | null;
  counts: StatusCount;
  /** % dentro do padrão (status "dentro") entre os analisados; null sem nenhum analisado. */
  scorePct: number | null;
  categories: SummaryCategory[];
  reports: number;
};

export function scorePct(c: StatusCount): number | null {
  return c.analisados > 0 ? Math.round((c.dentro / c.analisados) * 100) : null;
}

/**
 * Resumo = ÚLTIMO relatório de CADA pessoa (ou só de `memberId`). O % é dentro do padrão sobre os resultados que
 * têm faixa; "atenção" (perto do limite) e "fora" contam como "pedem atenção".
 */
export function buildSummary(reports: LabReport[], results: LabResult[], memberId?: string | null): LabSummary {
  const idx = indexByMember(reports, results);
  const latest: LabReport[] = [];
  for (const [id, m] of idx) {
    if (memberId && id !== memberId) continue;
    const l = lastOf(m.reports);
    if (l) latest.push(l);
  }
  const ids = new Set(latest.map((r) => r.id));
  const rows = results.filter((r) => ids.has(r.report_id));
  const statuses = rows.map((r) => statusOf(r));
  const counts = countStatuses(statuses);
  const categories: SummaryCategory[] = [];
  for (const cat of LAB_CATEGORIES) {
    const inCat = rows.filter((r) => r.category === cat);
    if (!inCat.length) continue;
    categories.push({ category: cat, label: LAB_CATEGORY_LABEL[cat], status: worstStatus(inCat.map((r) => statusOf(r))), total: inCat.length });
  }
  return {
    collectedOn: latest.map((r) => r.collected_on).sort().pop() ?? null,
    counts,
    scorePct: scorePct(counts),
    categories,
    reports: latest.length,
  };
}

/* ---------- Evolução (tabela por coleta) ---------- */

export type EvolutionCell = { value: string; status: LabStatus } | null;
export type EvolutionRow = {
  key: string;
  name: string;
  category: LabCategory;
  unit: string | null;
  cells: EvolutionCell[];
  status: LabStatus;
  trend: Trend | null;
  /** Sentido do valor (atual contra a anterior), para a seta; independe de ser bom ou ruim. */
  move: "up" | "down" | "same" | null;
};
export type Evolution = { columns: { reportId: string; date: string }[]; rows: EvolutionRow[]; totalReports: number };

export const EVOLUTION_COLUMNS = 3;

function moveOf(cur: LabValue, prev: LabValue | undefined): "up" | "down" | "same" | null {
  if (!prev || typeof cur.value_num !== "number" || typeof prev.value_num !== "number") return null;
  return cur.value_num > prev.value_num ? "up" : cur.value_num < prev.value_num ? "down" : "same";
}

const CATEGORY_ORDER = new Map<string, number>(LAB_CATEGORIES.map((c, i) => [c, i]));

/** As últimas `max` coletas da pessoa em colunas (mais antiga à esquerda) e uma linha por exame. */
export function buildEvolution(reports: LabReport[], results: LabResult[], memberId: string, max = EVOLUTION_COLUMNS): Evolution {
  const idx = indexByMember(reports, results).get(memberId);
  if (!idx) return { columns: [], rows: [], totalReports: 0 };
  const shown = idx.reports.slice(-max);
  const columns = shown.map((r) => ({ reportId: r.id, date: r.collected_on }));
  const rows: EvolutionRow[] = [];
  for (const [key, list] of idx.byKey) {
    const inShown = shown.map((r) => list.find((p) => p.report.id === r.id) ?? null);
    if (inShown.every((p) => p === null)) continue;
    const cur = lastOf(list)!;
    const prev = list.length > 1 ? list[list.length - 2] : null;
    rows.push({
      key,
      name: cur.result.name,
      category: cur.result.category,
      unit: cur.result.unit,
      cells: inShown.map((p) => (p ? { value: valueLabel(p.result), status: statusOf(p.result) } : null)),
      status: statusOf(cur.result),
      trend: trendOf(cur.result, prev?.result),
      move: moveOf(cur.result, prev?.result),
    });
  }
  rows.sort((a, b) => (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) || a.name.localeCompare(b.name, "pt-BR"));
  return { columns, rows, totalReports: idx.reports.length };
}

/* ---------- Série do gráfico ---------- */

export type SeriesPoint = { reportId: string; date: string; value: number; status: LabStatus };
export type Series = {
  key: string;
  name: string;
  category: LabCategory;
  unit: string | null;
  /** Só resultados numéricos, do mais antigo para o mais novo. */
  points: SeriesPoint[];
  /** Resultado mais recente (numérico ou texto) e a faixa do laboratório nele. */
  latest: { date: string; value: string; num: number | null; status: LabStatus; side: "acima" | "abaixo" | null; range: string | null; min: number | null; max: number | null } | null;
  trend: Trend | null;
  /** Data da coleta anterior (para "desde 02/26"). */
  prevDate: string | null;
  /** Primeira coleta da série (para "desde" na tendência sobre todo o período). */
  firstDate: string | null;
};

export type SeriesWindow = "todas" | "1a" | "6m";

export function buildSeries(reports: LabReport[], results: LabResult[], memberId: string, key: string): Series | null {
  const list = indexByMember(reports, results).get(memberId)?.byKey.get(key);
  if (!list?.length) return null;
  const cur = lastOf(list)!;
  const prev = list.length > 1 ? list[list.length - 2] : null;
  const points: SeriesPoint[] = list
    .filter((p) => typeof p.result.value_num === "number" && Number.isFinite(p.result.value_num))
    .map((p) => ({ reportId: p.report.id, date: p.report.collected_on, value: p.result.value_num as number, status: statusOf(p.result) }));
  const range = rangeOf(cur.result);
  return {
    key,
    name: cur.result.name,
    category: cur.result.category,
    unit: cur.result.unit,
    points,
    latest: {
      date: cur.report.collected_on,
      value: valueLabel(cur.result),
      num: typeof cur.result.value_num === "number" ? cur.result.value_num : null,
      status: statusOf(cur.result),
      side: where(cur.result),
      range: rangeLabel(cur.result),
      min: range.min,
      max: range.max,
    },
    trend: trendOf(cur.result, prev?.result),
    prevDate: prev?.report.collected_on ?? null,
    firstDate: list[0].report.collected_on,
  };
}

/** Recorta o gráfico pela janela (a contar de `today`); sempre mantém ao menos o último ponto. */
export function windowPoints(points: SeriesPoint[], window: SeriesWindow, today: string): SeriesPoint[] {
  if (window === "todas" || points.length === 0) return points;
  const from = addDays(today, window === "1a" ? -365 : -183);
  const kept = points.filter((p) => p.date >= from);
  return kept.length ? kept : [points[points.length - 1]];
}

export const isSeriesWindow = (v: unknown): v is SeriesWindow => v === "todas" || v === "1a" || v === "6m";

/* ---------- Textos ---------- */

const where = (r: LabValue): "acima" | "abaixo" | null => {
  if (typeof r.value_num !== "number") return null;
  const { min, max } = rangeOf(r);
  if (max !== null && r.value_num > max) return "acima";
  if (min !== null && r.value_num < min) return "abaixo";
  return null;
};

const upDown = (cur: LabValue, prev: LabValue) => ((cur.value_num as number) > (prev.value_num as number) ? "Subiu" : "Caiu");

/** "o que isso significa" do gráfico. Neutro: descreve a faixa do laboratório e a variação, sem interpretar clinicamente. */
export function meaningText(s: Series): string {
  const l = s.latest;
  if (!l) return "";
  const faixa =
    l.status === "fora"
      ? l.side === "acima"
        ? "acima da faixa de referência do laboratório"
        : l.side === "abaixo"
          ? "abaixo da faixa de referência do laboratório"
          : "fora da faixa de referência do laboratório"
      : l.status === "atencao"
        ? "dentro da faixa de referência do laboratório, perto de um dos limites"
        : l.status === "dentro"
          ? "dentro da faixa de referência do laboratório"
          : null;
  let lead = "";
  const v = s.points.map((p) => p.value);
  if (v.length >= 3 && monotonic(v)) {
    lead = `O resultado ${v[v.length - 1] > v[0] ? "subiu" : "caiu"} nas últimas ${v.length} coletas`;
  } else if (v.length >= 2 && s.prevDate) {
    const prev = v[v.length - 2];
    const cur = v[v.length - 1];
    lead = `O resultado ${cur === prev ? "ficou igual" : cur > prev ? "subiu" : "caiu"} desde a coleta de ${monthYearShort(s.prevDate)}`;
  }
  let first: string;
  if (faixa) first = lead ? `${lead} e está ${faixa}.` : `O último resultado está ${faixa}.`;
  else first = lead ? `${lead}. O laudo não traz faixa de referência para comparar.` : "O laudo não traz faixa de referência para este exame, então o app só mostra a variação.";
  return first + (l.status === "fora" ? " Converse com seu médico sobre este resultado." : " Repita o exame no prazo que seu médico indicar.");
}

function monotonic(v: number[]): boolean {
  let up = true;
  let down = true;
  for (let i = 1; i < v.length; i++) {
    if (v[i] <= v[i - 1]) up = false;
    if (v[i] >= v[i - 1]) down = false;
  }
  return up || down;
}

/** "Melhorou 56 pontos desde 02/26" para o cartão do último resultado. */
export function trendSentence(s: Series): string | null {
  if (!s.trend || !s.prevDate) return null;
  const since = `desde ${monthYearShort(s.prevDate)}`;
  const d = formatNumber(s.trend.delta);
  if (s.trend.dir === "estavel") return `Estável ${since}`;
  if (s.trend.base === "valor") return `${s.trend.dir === "subiu" ? "Subiu" : "Caiu"} ${d} ${since}`;
  return `${s.trend.dir === "melhorou" ? "Melhorou" : "Piorou"} ${d} ${d === "1" ? "ponto" : "pontos"} ${since}`;
}

/* ---------- Orientações ---------- */

export type OrientationItem = { titulo: string; texto: string; keys: string[] };
export type OrientationGroup = { key: "melhorar" | "dentro" | "indo_bem"; titulo: string; itens: OrientationItem[] };
export type Orientations = { grupos: OrientationGroup[]; aviso: string; collectedOn: string | null };

const GROUP_TITLE = { melhorar: "Pontos para melhorar", dentro: "Dentro do padrão", indo_bem: "Indo bem" } as const;

const MAX_NAMES = 8;
const joinNames = (n: string[]) => (n.length > MAX_NAMES ? `${n.slice(0, MAX_NAMES).join(", ")} e mais ${n.length - MAX_NAMES}` : n.join(", "));

const unitSuffix = (u: string | null) => (u ? ` ${u}` : "");

/** Orientações por regras sobre status e tendência do último resultado de cada exame (por pessoa; `names` rotula quando há mais de uma). */
export function buildOrientations(reports: LabReport[], results: LabResult[], memberId: string | null, names: Map<string, string>): Orientations {
  const idx = indexByMember(reports, results);
  const people = [...idx.keys()].filter((id) => !memberId || id === memberId);
  const multi = people.length > 1;
  const groups: Record<OrientationGroup["key"], OrientationItem[]> = { melhorar: [], dentro: [], indo_bem: [] };
  let collectedOn: string | null = null;

  for (const id of people) {
    const m = idx.get(id)!;
    const who = multi ? `${names.get(id) ?? "Pessoa"} · ` : "";
    const lastReport = lastOf(m.reports);
    if (lastReport && (!collectedOn || lastReport.collected_on > collectedOn)) collectedOn = lastReport.collected_on;
    const okNames: string[] = [];
    const edgeNames: string[] = [];
    const okKeys: string[] = [];
    const edgeKeys: string[] = [];
    const sorted = latestPerBiomarker(m).sort((a, b) => (CATEGORY_ORDER.get(a.cur.result.category) ?? 99) - (CATEGORY_ORDER.get(b.cur.result.category) ?? 99) || a.cur.result.name.localeCompare(b.cur.result.name, "pt-BR"));
    for (const { cur, prev } of sorted) {
      const r = cur.result;
      const st = statusOf(r);
      if (st === "sem_faixa") continue;
      const tr = trendOf(r, prev?.result);
      const since = prev ? ` desde ${monthYearShort(prev.report.collected_on)}` : "";
      const title = `${who}${r.name}: ${valueLabel(r)}${unitSuffix(r.unit)}`;
      const side = where(r);
      if (st === "fora" || (st === "atencao" && tr?.dir === "piorou")) {
        let texto: string;
        if (st === "atencao") {
          texto = `Piorou${since} e está perto de um dos limites da faixa do laboratório. Acompanhe nas próximas coletas.`;
        } else if (!side) {
          texto = `Resultado diferente do esperado pela referência do laboratório. Vale conversar com seu médico.`;
        } else if (tr && prev && tr.dir !== "estavel") {
          const mov = typeof r.value_num === "number" && typeof prev.result.value_num === "number" ? upDown(r, prev.result) : "Variou";
          texto = tr.dir === "melhorou"
            ? `${mov}${since} e melhorou, mas ainda está ${side} da faixa do laboratório. Vale conversar com seu médico.`
            : `${mov}${since} e está ${side} da faixa do laboratório. Vale conversar com seu médico.`;
        } else {
          texto = `Está ${side} da faixa de referência do laboratório. Vale conversar com seu médico.`;
        }
        groups.melhorar.push({ titulo: title, texto, keys: [r.biomarker_key] });
      } else if (tr?.dir === "melhorou") {
        const mov = typeof r.value_num === "number" && prev && typeof prev.result.value_num === "number" ? upDown(r, prev.result) : "Melhorou";
        groups.indo_bem.push({ titulo: `${who}${r.name}`, texto: `${mov} para ${valueLabel(r)}${unitSuffix(r.unit)}, dentro da faixa do laboratório.`, keys: [r.biomarker_key] });
      } else if (st === "atencao") {
        edgeNames.push(r.name);
        edgeKeys.push(r.biomarker_key);
      } else {
        okNames.push(r.name);
        okKeys.push(r.biomarker_key);
      }
    }
    if (okNames.length) groups.dentro.push({ titulo: `${who}${joinNames(okNames)}`, texto: "Na faixa de referência do laboratório. Continue com o acompanhamento de rotina.", keys: okKeys });
    if (edgeNames.length) groups.dentro.push({ titulo: `${who}${joinNames(edgeNames)}`, texto: "Dentro da faixa, mas perto de um dos limites. Acompanhe nas próximas coletas.", keys: edgeKeys });
  }
  const grupos = (Object.keys(groups) as OrientationGroup["key"][])
    .filter((k) => groups[k].length > 0)
    .map((k) => ({ key: k, titulo: GROUP_TITLE[k], itens: groups[k] }));
  return { grupos, aviso: ORIENTATION_NOTICE, collectedOn };
}
