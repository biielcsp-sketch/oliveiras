/** Geometria do gráfico de linha (SVG próprio, sem biblioteca). Funções puras, testadas em tests/unit. */
import type { SeriesPoint } from "./summary";

export const CHART = { width: 340, height: 210, left: 40, right: 16, top: 16, bottom: 30 } as const;

export type ChartInput = { points: SeriesPoint[]; refMin: number | null; refMax: number | null };
export type ChartGeometry = {
  dots: { x: number; y: number; point: SeriesPoint }[];
  /** Faixa ideal sombreada (y do topo e altura), recortada ao quadro; null sem faixa. */
  band: { y: number; height: number } | null;
  ticks: { y: number; value: number }[];
  domain: { min: number; max: number };
};

const timeOf = (d: string) => Date.parse(`${d}T12:00:00Z`);

/** Eixo Y cobre os valores e a faixa, com folga de 12%; eixo X proporcional às datas (um ponto só fica no centro). */
export function chartGeometry({ points, refMin, refMax }: ChartInput): ChartGeometry {
  const vals = points.map((p) => p.value);
  const all = [...vals, ...(refMin !== null ? [refMin] : []), ...(refMax !== null ? [refMax] : [])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  const min = lo - pad;
  const max = hi + pad;
  const plotW = CHART.width - CHART.left - CHART.right;
  const plotH = CHART.height - CHART.top - CHART.bottom;
  const y = (v: number) => CHART.top + plotH * (1 - (v - min) / (max - min));
  const t0 = points.length ? timeOf(points[0].date) : 0;
  const t1 = points.length ? timeOf(points[points.length - 1].date) : 0;
  const x = (d: string) => (t1 === t0 ? CHART.left + plotW / 2 : CHART.left + (plotW * (timeOf(d) - t0)) / (t1 - t0));
  const dots = points.map((p) => ({ x: x(p.date), y: y(p.value), point: p }));
  let band: ChartGeometry["band"] = null;
  if (refMin !== null || refMax !== null) {
    const top = y(refMax ?? max);
    const bottom = y(refMin ?? min);
    band = { y: top, height: Math.max(0, bottom - top) };
  }
  const ticks = [0, 1, 2, 3].map((i) => {
    const value = min + ((max - min) * i) / 3;
    return { y: y(value), value };
  });
  return { dots, band, ticks, domain: { min, max } };
}
