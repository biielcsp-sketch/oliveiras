"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ResetRequestState } from "./actions";
import { Button, Field, FormError, Input } from "@/components/ui";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState<ResetRequestState, FormData>(requestPasswordReset, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <FormError message={state?.error} />
      {state?.info && (
        <p role="status" className="text-sm text-olive">
          {state.info}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Aguarde…" : "Enviar link"}
      </Button>
    </form>
  );
}
