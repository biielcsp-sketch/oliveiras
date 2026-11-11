"use client";

import { useActionState } from "react";
import { updatePassword, type NewPasswordState } from "./actions";
import { Button, Field, FormError, Input } from "@/components/ui";

export function NewPasswordForm() {
  const [state, action, pending] = useActionState<NewPasswordState, FormData>(updatePassword, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nova senha">
        <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirmar nova senha">
        <Input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Aguarde…" : "Redefinir senha"}
      </Button>
    </form>
  );
}
