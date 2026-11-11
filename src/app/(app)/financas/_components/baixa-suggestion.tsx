"use client";

import { useActionState } from "react";
import { dismissSuggestion, payBill, type PlanState } from "../planning-actions";
import { FormError } from "@/components/ui";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";

type Props = { billId: string; billName: string; month: string; transactionId: string; description: string; date: string; amount: number };

/** "Parece o pagamento de X — Confirmar / Não é". Confirmar usa a mesma ação de "Marcar paga" (servidor valida o lançamento). */
export function BaixaSuggestion({ billId, billName, month, transactionId, description, date, amount }: Props) {
  const [state, action, pending] = useActionState<PlanState, FormData>(payBill, null);
  return (
    <div className="mt-2 rounded-2xl bg-accent-soft px-3 py-2.5 text-[13px]" role="group" aria-label={`Sugestão de pagamento de ${billName}`}>
      <p>
        Parece o pagamento de <strong>{billName}</strong>: {description} · {shortDate(date)} · {formatBRL(-amount)}
      </p>
      <div className="mt-2 flex items-center gap-4">
        <form action={action}>
          <input type="hidden" name="bill_id" value={billId} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="transaction_id" value={transactionId} />
          <button className="font-medium text-olive" disabled={pending}>
            {pending ? "Salvando…" : "Confirmar"}
          </button>
        </form>
        <form action={dismissSuggestion}>
          <input type="hidden" name="bill_id" value={billId} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="transaction_id" value={transactionId} />
          <button className="text-muted underline">Não é</button>
        </form>
      </div>
      <FormError message={state?.error} />
    </div>
  );
}
