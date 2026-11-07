"use client";

import { useActionState, useState } from "react";
import { payBill, type PlanState } from "../planning-actions";
import { Button, Field, FormError, Input } from "@/components/ui";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";
import type { Transaction } from "@/lib/financas/types";

type Props = {
  billId: string;
  month: string;
  expected: number;
  due: string;
  suggestions: (Transaction & { accountName: string })[];
};

export function PayForm({ billId, month, expected, due, suggestions }: Props) {
  const [state, action, pending] = useActionState<PlanState, FormData>(payBill, null);
  const [choice, setChoice] = useState(suggestions[0]?.id ?? "sem");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="bill_id" value={billId} />
      <input type="hidden" name="month" value={month} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">
          {suggestions.length > 0
            ? "Encontramos estes lançamentos parecidos no extrato:"
            : "Nenhum lançamento parecido no extrato. Importe o extrato ou marque como paga sem lançamento."}
        </legend>
        {suggestions.map((t) => (
          <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 has-[:checked]:border-olive">
            <input type="radio" name="transaction_id" value={t.id} checked={choice === t.id} onChange={() => setChoice(t.id)} className="accent-[var(--olive)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{t.description}</span>
              <span className="text-[12px] text-muted">{shortDate(t.date)} · {t.accountName}</span>
            </span>
            <span className="text-sm tabular-nums">{formatBRL(t.amount)}</span>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 has-[:checked]:border-olive">
          <input type="radio" name="transaction_id" value="sem" checked={choice === "sem"} onChange={() => setChoice("sem")} className="accent-[var(--olive)]" />
          <span className="text-sm">Paga sem lançamento no app</span>
        </label>
      </fieldset>

      {choice === "sem" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pago em">
            <Input name="paid_on" type="date" defaultValue={due} required />
          </Field>
          <Field label="Valor pago (R$)">
            <Input name="amount" inputMode="decimal" defaultValue={expected.toFixed(2).replace(".", ",")} required />
          </Field>
        </div>
      )}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : "Confirmar pagamento"}</Button>
    </form>
  );
}
