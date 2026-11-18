"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui";

const HIDDEN = "R$ ••••••";

/**
 * Card azul do Resumo das Finanças: dinheiro disponível nas contas, faturas dos cartões e, do mês, entradas, saídas e saldo.
 * Os valores chegam já formatados do servidor (mesmo cálculo de antes); o olho só esconde/mostra na tela, sem gravar nada.
 */
export function ResumoSaldo({
  available,
  cardDebt,
  income,
  expense,
  result,
  caption,
}: {
  available: string;
  /** null: sem cartões, a linha das faturas não aparece */
  cardDebt: string | null;
  income: string;
  expense: string;
  result: string;
  caption: string;
}) {
  const [hidden, setHidden] = useState(false);
  const show = (v: string) => (hidden ? HIDDEN : v);
  return (
    <Card tone="hero" className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-medium">Disponível nas contas</p>
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
          aria-pressed={hidden}
          className="-my-2 -mr-2 grid size-11 place-items-center rounded-full text-white transition hover:bg-white/15"
        >
          {hidden ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </div>
      <p className="mt-1 text-[32px] font-bold tracking-tight tabular-nums">{show(available)}</p>
      {cardDebt !== null && (
        <p className="mt-1 text-[13px] text-info">
          Faturas dos cartões: <span className="tabular-nums">{show(cardDebt)}</span>
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-white/15 px-3.5 py-3">
          <p className="flex items-center justify-between text-[12.5px] text-info">
            Entradas <ArrowUp size={14} strokeWidth={2.2} aria-hidden />
          </p>
          <p className="mt-0.5 whitespace-nowrap text-[16px] font-semibold tabular-nums">{show(income)}</p>
        </div>
        <div className="rounded-2xl bg-white/15 px-3.5 py-3">
          <p className="flex items-center justify-between text-[12.5px] text-info">
            Saídas <ArrowDown size={14} strokeWidth={2.2} aria-hidden />
          </p>
          <p className="mt-0.5 whitespace-nowrap text-[16px] font-semibold tabular-nums">{show(expense)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/20 pt-3">
        <div className="min-w-0">
          <p className="text-[13px] text-info">Saldo do mês</p>
          <p className="truncate text-[12px] text-info opacity-80">{caption}</p>
        </div>
        <p className="shrink-0 whitespace-nowrap text-[18px] font-semibold tabular-nums" data-testid="saldo-do-mes">
          {show(result)}
        </p>
      </div>
    </Card>
  );
}
