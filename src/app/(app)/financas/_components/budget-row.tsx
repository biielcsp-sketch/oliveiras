"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { saveBudget, type PlanState } from "../planning-actions";
import { FormError, Input, Select } from "@/components/ui";
import { formatBRL } from "@/lib/financas/money";

type Props = {
  categoryId: string;
  name: string;
  color: string;
  month: string;
  spent: number;
  budget: { amount: number; override: boolean } | undefined;
};

export function BudgetRow({ categoryId, name, color, month, spent, budget }: Props) {
  const [state, action, pending] = useActionState<PlanState, FormData>(saveBudget, null);
  const [editing, setEditing] = useState(false);
  const amount = budget?.amount ?? 0;
  const pct = amount > 0 ? spent / amount : spent > 0 ? 1 : 0;
  const over = amount > 0 && spent > amount;

  return (
    <li className="py-3">
      <button type="button" onClick={() => setEditing((v) => !v)} className="block w-full text-left" aria-expanded={editing}>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{name}</span>
            {budget?.override && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-muted">só este mês</span>}
          </span>
          <span className="shrink-0 tabular-nums">
            <span className={clsx(over && "text-danger")}>{formatBRL(spent)}</span>
            <span className="text-muted"> / {budget ? formatBRL(amount) : "sem orçamento"}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
          <div
            className={clsx("h-full rounded-full", over ? "bg-danger" : "bg-olive")}
            style={{ width: `${Math.min(pct, 1) * 100}%` }}
          />
        </div>
        {budget && amount > 0 && (
          <p className={clsx("mt-1 text-[12px]", over ? "text-danger" : "text-muted")}>
            {over ? `Passou ${formatBRL(spent - amount)}` : `Restam ${formatBRL(amount - spent)}`}
          </p>
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
    </li>
  );
}
