"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Search } from "lucide-react";
import { Card } from "@/components/ui";
import { normalizeText } from "@/lib/saude/labs/catalog";
import { STATUS_LABEL, TREND_LABEL, type LabStatus, type TrendDir } from "@/lib/saude/labs/status";
import { STATUS_TEXT, TrendIcon } from "./lab-ui";

export type EvolutionRowVM = {
  key: string;
  name: string;
  unit: string | null;
  cells: ({ value: string; status: LabStatus } | null)[];
  status: LabStatus;
  trend: TrendDir | null;
  move: "up" | "down" | "same" | null;
};

type Chip = "todos" | "fora" | "piorou";
const CHIPS: { key: Chip; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "fora", label: "Fora do padrão" },
  { key: "piorou", label: "Piorou" },
];

/** Tabela por coleta: filtro de texto e chips (Todos / Fora do padrão / Piorou); toque no exame abre o gráfico. */
export function EvolutionTable({ columns, rows, query }: { columns: string[]; rows: EvolutionRowVM[]; query: string }) {
  const [text, setText] = useState("");
  const [chip, setChip] = useState<Chip>("todos");
  const shown = useMemo(() => {
    const t = normalizeText(text);
    return rows.filter((r) => (!t || normalizeText(r.name).includes(t)) && (chip === "todos" || (chip === "fora" ? r.status === "fora" : r.trend === "piorou")));
  }, [rows, text, chip]);
  const grid = { gridTemplateColumns: `minmax(0,1fr) ${columns.map(() => "52px").join(" ")} 34px` };

  return (
    <>
      <label className="glass-card flex h-11 items-center gap-2 rounded-full px-3.5">
        <Search size={16} className="text-muted" aria-hidden />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Filtrar exames…"
          aria-label="Filtrar exames"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
        />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtro">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={chip === c.key}
            onClick={() => setChip(c.key)}
            className={clsx(
              "relative inline-flex h-[34px] items-center whitespace-nowrap rounded-full px-3.5 text-[13px] transition",
              chip === c.key ? "bg-accent-soft font-semibold text-deep shadow-soft" : "glass-card font-medium text-ink hover:text-primary",
            )}
          >
            <span aria-hidden className="absolute left-1/2 top-1/2 h-full min-h-11 w-full min-w-11 -translate-x-1/2 -translate-y-1/2" />
            {c.label}
          </button>
        ))}
      </div>
      <Card className="!p-2 !pb-1" data-testid="evolucao-tabela">
        <div className="grid h-8 items-center px-2 text-[11.5px] font-semibold text-muted" style={grid}>
          <span>Exame</span>
          {columns.map((c, i) => (
            <span key={i} className="text-center">
              {c}
            </span>
          ))}
          <span />
        </div>
        {shown.map((r) => (
          <Link
            key={r.key}
            href={`/saude/evolucao/${r.key}${query}`}
            data-testid="evolucao-linha"
            className="grid min-h-12 items-center border-t border-line px-2 text-[13px]"
            style={grid}
          >
            <span className="truncate font-medium">{r.name}</span>
            {r.cells.map((c, i) => {
              const last = i === r.cells.length - 1;
              return (
                <span key={i} className={clsx("text-center", last ? clsx("font-semibold", STATUS_TEXT[c?.status ?? "sem_faixa"]) : "text-muted")}>
                  {c ? c.value : "–"}
                  {last && c && <span className="sr-only"> ({STATUS_LABEL[c.status]})</span>}
                </span>
              );
            })}
            <TrendIcon dir={r.trend} move={r.move} label={r.trend ? TREND_LABEL[r.trend] : ""} />
          </Link>
        ))}
        {shown.length === 0 && <p className="border-t border-line px-2 py-4 text-center text-[13px] text-muted">Nenhum exame com esse filtro.</p>}
      </Card>
    </>
  );
}
