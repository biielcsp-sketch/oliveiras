"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { saveBudget, type PlanState } from "../planning-actions";
import { FormError, Input, Select } from "@/components/ui";
import { formatBRL } from "@/lib/financas/money";
import { budgetStatus } from "@/lib/financas/budget-view";

type Props = {
  categoryId: string;
  name: string;
  color: string;
  month: string;
  spent: number;
  budget: { amount: number; override: boolean } | undefined;
};

const BAR = { ok: "bg-success", atencao: "bg-[#E8A317]", estourou: "bg-danger", "sem-meta": "" } as const;

/** Bloco de categoria da grade do Orçamento; tocar abre o editor do valor (todo mês / só este mês). */
export function BudgetRow({ categoryId, name, color, month, spent, budget }: Props) {
  const [state, action, pending] = useActionState<PlanState, FormData>(saveBudget, null);
  const [editing, setEditing] = useState(false);
  const amount = budget?.amount ?? 0;
  const status = budgetStatus(spent, amount);
  const hasBudget = status !== "sem-meta";
  const over = status === "estourou";
  const pct = hasBudget ? Math.min(spent / amount, 1) * 100 : 0;

  return (
    <li className={clsx(editing && "col-span-2")}>
      <div
        className={clsx(
          "glass-card h-full rounded-[18px] p-3",
          !hasBudget && "border border-dashed border-line",
          over && "border border-danger",
        )}
      >
        <button type="button" onClick={() => setEditing((v) => !v)} className="block w-full text-left" aria-expanded={editing}>
          <span className="flex items-start gap-2">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
              style={{ background: color }}
              aria-hidden
            >
              {name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-tight [overflow-wrap:anywhere]">{name}</span>
          </span>
          <span className={clsx("mt-2 block text-[17px] font-bold tabular-nums", over && "text-danger")}>{formatBRL(spent)}</span>
          {hasBudget ? (
            <>
              <span className="block text-[12px] text-muted tabular-nums">de {formatBRL(amount)}</span>
              <span className="mt-1.5 block h-1.5 rounded-full bg-surface-2">
                <span className={clsx("block h-full rounded-full", BAR[status])} style={{ width: `${pct}%` }} />
              </span>
              {over && <span className="mt-1 block text-[12px] font-medium text-danger">passou {formatBRL(spent - amount)}</span>}
              {budget?.override && <span className="mt-1 inline-block rounded bg-surface-2 px-1.5 text-[11px] text-muted">só este mês</span>}
            </>
          ) : (
            <span className="mt-1 block text-[12.5px] font-medium text-primary">+ Definir meta</span>
          )}
        </button>

        {editing && (
          <form action={action} className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
            <input type="hidden" name="category_id" value={categoryId} />
            <input type="hidden" name="month" value={month} />
            <Input
              name="amount"
              inputMode="decimal"
              placeholder="Valor (vazio remove)"
              aria-label={`Orçamento de ${name}`}
              defaultValue={budget ? amount.toFixed(2).replace(".", ",") : ""}
            />
            <Select name="scope" aria-label="Vale para" className="w-36" defaultValue={budget?.override ? "mes" : "padrao"}>
              <option value="padrao">Todo mês</option>
              <option value="mes">Só este mês</option>
            </Select>
            <button disabled={pending} className="h-11 rounded-full glass-primary px-5 text-[15px] font-medium disabled:opacity-50">
              Salvar
            </button>
            <div className="col-span-3">
              <FormError message={state?.error} />
            </div>
          </form>
        )}
      </div>
    </li>
  );
}
