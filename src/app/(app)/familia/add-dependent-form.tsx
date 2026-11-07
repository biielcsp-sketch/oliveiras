"use client";

import { useActionState, useEffect, useRef } from "react";
import { addDependent, type ActionState } from "./actions";
import { Button, Field, FormError, Input } from "@/components/ui";

export function AddDependentForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addDependent, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <Field label="Nome">
        <Input name="name" placeholder="Nome do dependente" required />
      </Field>
      <Field label="Nascimento">
        <Input name="birth_date" type="date" />
      </Field>
      <input type="hidden" name="relation" value="filho" />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Adicionar"}
      </Button>
      <div className="sm:col-span-3">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}
