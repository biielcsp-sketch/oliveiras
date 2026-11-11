"use client";

import { useActionState } from "react";
import Link from "next/link";
import { deleteBill, type PlanState } from "../planning-actions";
import { Button } from "@/components/ui";

/** Confirmação explícita: só apaga ao clicar em "Excluir conta e pagamentos"; erro nunca vira redirecionamento. */
export function BillDeleteForm({ billId, voltar, mes, cancelHref }: { billId: string; voltar?: "casa"; mes?: string; cancelHref: string }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(deleteBill, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={billId} />
      {voltar === "casa" && <input type="hidden" name="voltar" value="casa" />}
      {mes && <input type="hidden" name="mes" value={mes} />}
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button variant="danger" disabled={pending} className="w-full">
        {pending ? "Excluindo…" : "Excluir conta e pagamentos"}
      </Button>
      <Link href={cancelHref} className="inline-flex min-h-11 items-center justify-center text-[15px] font-medium text-link">
        Cancelar
      </Link>
    </form>
  );
}
