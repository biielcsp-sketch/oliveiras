import { chartGeometry, CHART } from "@/lib/saude/labs/chart";
import { formatNumber, STATUS_LABEL } from "@/lib/saude/labs/status";
import { monthYearShort, type SeriesPoint } from "@/lib/saude/labs/summary";

const DOT = { dentro: "fill-success", atencao: "fill-warning", fora: "fill-danger", sem_faixa: "fill-primary" } as const;

/** Gráfico de linha em SVG próprio: faixa ideal do laboratório sombreada, pontos coloridos pelo status e tabela para leitor de tela. */
export function LabChart({ name, unit, points, refMin, refMax, rangeText }: { name: string; unit: string | null; points: SeriesPoint[]; refMin: number | null; refMax: number | null; rangeText: string | null }) {
  const g = chartGeometry({ points, refMin, refMax });
  const line = g.dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(" ");
  const u = unit ? ` ${unit}` : "";
  const summary = `${name}: ${points.map((p) => `${monthYearShort(p.date)} ${formatNumber(p.value)}${u}`).join(", ")}.${rangeText ? ` Faixa do laboratório: ${rangeText}.` : ""}`;
  // Poucos rótulos no eixo X para não encavalar (no máximo 5).
  const step = Math.max(1, Math.ceil(g.dots.length / 5));
  return (
    <>
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={summary} className="h-auto w-full" data-testid="lab-chart">
        {g.ticks.map((t, i) => (
          <g key={i}>
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={t.y} y2={t.y} className="stroke-line" strokeWidth="1" />
            <text x={CHART.left - 6} y={t.y + 3.5} textAnchor="end" fontSize="10" className="fill-muted">
              {formatNumber(Math.round(t.value * 10) / 10)}
            </text>
          </g>
        ))}
        {g.band && <rect data-testid="lab-chart-faixa" x={CHART.left} width={CHART.width - CHART.left - CHART.right} y={g.band.y} height={g.band.height} className="fill-success/15" />}
        {g.dots.length > 1 && <path d={line} fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {g.dots.map((d, i) => (
          <g key={d.point.reportId}>
            <circle cx={d.x} cy={d.y} r="5" className={DOT[d.point.status]} stroke="#fff" strokeWidth="2" data-testid="lab-chart-ponto">
              <title>{`${monthYearShort(d.point.date)}: ${formatNumber(d.point.value)}${u} (${STATUS_LABEL[d.point.status]})`}</title>
            </circle>
            {i % step === 0 && (
              <text x={d.x} y={CHART.height - 10} textAnchor="middle" fontSize="10" className="fill-muted">
                {monthYearShort(d.point.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{`Resultados de ${name}`}</caption>
        <thead>
          <tr>
            <th>Coleta</th>
            <th>Valor</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.reportId}>
              <td>{monthYearShort(p.date)}</td>
              <td>{`${formatNumber(p.value)}${u}`}</td>
              <td>{STATUS_LABEL[p.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
