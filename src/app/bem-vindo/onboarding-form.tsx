"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { createHousehold, joinHousehold, type OnboardState } from "./actions";
import { Button, Field, FormError, Input } from "@/components/ui";

export function OnboardingForm() {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [cState, cAction, cPending] = useActionState<OnboardState, FormData>(createHousehold, null);
  const [jState, jAction, jPending] = useActionState<OnboardState, FormData>(joinHousehold, null);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 rounded-full bg-surface-2 p-1 text-[15px]">
        {(
          [
            ["create", "Criar família"],
            ["join", "Entrar com código"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={clsx("h-11 rounded-full transition", mode === m ? "bg-surface-solid font-semibold text-deep shadow-soft" : "font-medium text-muted")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "create" ? (
        <form action={cAction} className="flex flex-col gap-4">
          <Field label="Nome da família">
            <Input name="family" defaultValue="Família Oliveira Rodrigues" required />
          </Field>
          <Field label="Seu nome">
            <Input name="name" autoComplete="given-name" required />
          </Field>
          <FormError message={cState?.error} />
          <Button disabled={cPending}>{cPending ? "Criando…" : "Criar família"}</Button>
        </form>
      ) : (
        <form action={jAction} className="flex flex-col gap-4">
          <Field label="Código de convite">
            <Input name="code" className="font-mono uppercase tracking-widest" maxLength={8} required />
          </Field>
          <Field label="Seu nome">
            <Input name="name" autoComplete="given-name" required />
          </Field>
          <FormError message={jState?.error} />
          <Button disabled={jPending}>{jPending ? "Entrando…" : "Entrar na família"}</Button>
        </form>
      )}
    </div>
  );
}
