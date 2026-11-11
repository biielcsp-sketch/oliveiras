"use client";

import { useActionState } from "react";
import { deleteDocument, type DocState } from "../documentos-actions";
import { Button, FormError } from "@/components/ui";

/**
 * Confirmação explícita de apagar. Com lançamento criado pelo documento, a pessoa escolhe:
 * só o documento (lançamento e baixa ficam) ou documento + lançamento + baixa.
 */
export function DocDeleteForm({ id, createdTransaction }: { id: string; createdTransaction: boolean }) {
  const [state, action, pending] = useActionState<DocState, FormData>(deleteDocument, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {createdTransaction ? (
        <>
          <Button variant="danger" name="mode" value="documento" disabled={pending}>
            Apagar só o documento
          </Button>
          <Button variant="danger" name="mode" value="tudo" disabled={pending}>
            Apagar documento e o lançamento/baixa criados por ele
          </Button>
        </>
      ) : (
        <Button variant="danger" name="mode" value="documento" disabled={pending}>
          {pending ? "Apagando…" : "Apagar documento"}
        </Button>
      )}
      <FormError message={state?.error} />
    </form>
  );
}
