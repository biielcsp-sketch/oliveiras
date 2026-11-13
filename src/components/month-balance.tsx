"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";

const HIDDEN = "R$ ••••••";

/** Barrinhas decorativas do card de saldo (como na prévia). */
function Bars({ light }: { light: boolean }) {
  return (
    <span aria-hidden="true" className="flex items-end gap-1.5">
      {[26, 36, 50, 66].map((h) => (
        <span
          key={h}
          className={clsx(
            "w-3 rounded-md shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_0_10px_rgb(120_180_255/0.45)]",
            light
              ? "bg-[linear-gradient(180deg,rgb(255_255_255/0.9),rgb(255_255_255/0.55))]"
              : "bg-[linear-gradient(180deg,rgb(120_165_245/0.95),rgb(120_165_245/0.45))]",
          )}
          style={{ height: h }}
        />
      ))}
    </span>
  );
}

/**
 * Card "Saldo do mês" com Entradas e Saídas. Os valores chegam já formatados do servidor (mesmo cálculo
 * do resumo das Finanças); o olho só esconde/mostra os valores na tela, sem gravar nada.
 * `tone="hero"`: card azul (raiz das Finanças); `glass`: card de vidro (Início).
 */
export function MonthBalance({
  tone = "glass",
  result,
  income,
  expense,
  caption,
}: {
  tone?: "glass" | "hero";
  result: string;
  income: string;
  expense: string;
  caption?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const hero = tone === "hero";
  const show = (v: string) => (hidden ? HIDDEN : v);
  return (
    <div className="flex flex-col gap-3">
      <div className={clsx("flex items-end justify-between gap-3 p-[18px]", hero ? "card-hero rounded-[22px] p-5" : "glass-card rounded-[20px]")}>
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[15px] font-medium">
            Saldo do mês
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
              aria-pressed={hidden}
              className={clsx(
                "-my-2 grid size-11 place-items-center rounded-full transition",
                hero ? "text-white hover:bg-white/15" : "text-ink hover:bg-accent-soft",
              )}
            >
              {hidden ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </p>
          <p className="mt-1 text-[30px] font-bold tracking-tight tabular-nums" data-testid="saldo-do-mes">
            {show(result)}
          </p>
          {caption && <p className={clsx("mt-1.5 text-[13px]", hero ? "text-info" : "text-muted")}>{caption}</p>}
        </div>
        <Bars light={hero} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[18px] border border-[var(--glass-edge)] bg-success-soft px-4 py-3.5 shadow-[0_8px_20px_rgb(30_120_90/0.08)]">
          <p className="text-[13.5px] font-medium">Entradas</p>
          <p className="mt-1 flex items-center justify-between gap-2 text-[18px] font-bold tabular-nums text-success">
            <span className="truncate">{show(income)}</span>
            <ArrowUp size={17} strokeWidth={2.2} className="shrink-0 text-deep" aria-hidden />
          </p>
        </div>
        <div className="rounded-[18px] border border-[var(--glass-edge)] bg-danger-soft px-4 py-3.5 shadow-[0_8px_20px_rgb(190_60_60/0.08)]">
          <p className="text-[13.5px] font-medium">Saídas</p>
          <p className="mt-1 flex items-center justify-between gap-2 text-[18px] font-bold tabular-nums text-danger">
            <span className="truncate">{show(expense)}</span>
            <ArrowDown size={17} strokeWidth={2.2} className="shrink-0" aria-hidden />
          </p>
        </div>
      </div>
    </div>
  );
}
