"use client";

import { useActionState } from "react";
import Link from "next/link";
import { deleteOneOff, type OneOffState } from "../avulsas-actions";
import { Button } from "@/components/ui";

/** Confirmação explícita: só apaga ao clicar no botão; erro nunca vira redirecionamento. */
export function OneOffDeleteForm({ id, voltar, mes, cancelHref }: { id: string; voltar?: "casa"; mes?: string; cancelHref: string }) {
  const [state, action, pending] = useActionState<OneOffState, FormData>(deleteOneOff, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {voltar === "casa" && <input type="hidden" name="voltar" value="casa" />}
      {mes && <input type="hidden" name="mes" value={mes} />}
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button variant="danger" disabled={pending} className="w-full">
        {pending ? "Apagando…" : "Apagar conta avulsa"}
      </Button>
      <Link href={cancelHref} className="inline-flex min-h-11 items-center justify-center text-[15px] font-medium text-link">
        Cancelar
      </Link>
    </form>
  );
}
