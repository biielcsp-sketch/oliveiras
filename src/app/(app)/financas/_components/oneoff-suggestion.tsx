"use client";

import { useActionState } from "react";
import { dismissOneOffSuggestion, payOneOff, type OneOffState } from "../avulsas-actions";
import { FormError } from "@/components/ui";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";

type Props = { oneOffId: string; name: string; month: string; transactionId: string; description: string; date: string; amount: number };

/** Igual à sugestão das fixas: "Confirmar" usa a mesma ação de "Marcar paga" (o servidor valida o lançamento). */
export function OneOffSuggestion({ oneOffId, name, month, transactionId, description, date, amount }: Props) {
  const [state, action, pending] = useActionState<OneOffState, FormData>(payOneOff, null);
  return (
    <div className="mt-2 rounded-2xl bg-accent-soft px-3 py-2.5 text-[13px]" role="group" aria-label={`Sugestão de pagamento de ${name}`}>
      <p>
        Parece o pagamento de <strong>{name}</strong>: {description} · {shortDate(date)} · {formatBRL(-amount)}
      </p>
      <div className="mt-2 flex items-center gap-4">
        <form action={action}>
          <input type="hidden" name="one_off_id" value={oneOffId} />
          <input type="hidden" name="transaction_id" value={transactionId} />
          <button className="font-medium text-olive" disabled={pending}>
            {pending ? "Salvando…" : "Confirmar"}
          </button>
        </form>
        <form action={dismissOneOffSuggestion}>
          <input type="hidden" name="one_off_id" value={oneOffId} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="transaction_id" value={transactionId} />
          <button className="text-muted underline">Não é</button>
        </form>
      </div>
      <FormError message={state?.error} />
    </div>
  );
}
