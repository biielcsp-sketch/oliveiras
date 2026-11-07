"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { signIn, signUp, type AuthState } from "./actions";
import { Button, Field, FormError, Input } from "@/components/ui";

export function LoginForm() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [inState, inAction, inPending] = useActionState<AuthState, FormData>(signIn, null);
  const [upState, upAction, upPending] = useActionState<AuthState, FormData>(signUp, null);
  const state = mode === "in" ? inState : upState;
  const pending = inPending || upPending;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-sm">
        {(["in", "up"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={clsx(
              "h-9 rounded-lg transition",
              mode === m ? "bg-surface font-medium shadow-sm" : "text-muted",
            )}
          >
            {m === "in" ? "Entrar" : "Criar conta"}
          </button>
        ))}
      </div>

      <form action={mode === "in" ? inAction : upAction} className="flex flex-col gap-4">
        <Field label="E-mail">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Senha">
          <Input
            name="password"
            type="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            minLength={mode === "up" ? 8 : undefined}
            required
          />
        </Field>
        <FormError message={state?.error} />
        {state?.info && <p className="text-sm text-olive">{state.info}</p>}
        <Button type="submit" disabled={pending} className="mt-1">
          {pending ? "Aguarde…" : mode === "in" ? "Entrar" : "Criar conta"}
        </Button>
      </form>
    </div>
  );
}
