"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signIn, signUp, type AuthState } from "./actions";
import { Button, Field, FormError, Input } from "@/components/ui";
import { PasskeySignIn } from "./passkey-sign-in";

export function LoginForm({ notice, defaultEmail, remembered = false }: { notice?: string; defaultEmail?: string; remembered?: boolean }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [inState, inAction, inPending] = useActionState<AuthState, FormData>(signIn, null);
  const [upState, upAction, upPending] = useActionState<AuthState, FormData>(signUp, null);
  const state = mode === "in" ? inState : upState;
  const pending = inPending || upPending;

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p role="status" className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      )}

      <form action={mode === "in" ? inAction : upAction} className="flex flex-col gap-4">
        <Field label="E-mail">
          <Input name="email" type="email" autoComplete="email" defaultValue={defaultEmail} required />
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
        {mode === "in" && (
          <Link href="/esqueci-senha" className="-mt-2 self-end text-[13px] text-muted underline-offset-4 hover:underline">
            Esqueci minha senha
          </Link>
        )}
        {mode === "in" && (
          <label className="-mt-1 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="remember" defaultChecked={remembered} className="h-4 w-4 accent-primary" />
            Lembrar neste aparelho
          </label>
        )}
        <FormError message={state?.error} />
        {state?.info && <p className="text-sm text-olive">{state.info}</p>}
        <Button type="submit" disabled={pending} className="mt-1">
          {pending ? "Aguarde…" : mode === "in" ? "Entrar" : "Criar conta"}
        </Button>
      </form>

      {mode === "in" && <PasskeySignIn />}

      <p className="text-center text-sm text-muted">
        {mode === "in" ? "Não tem conta? " : "Já tem conta? "}
        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="font-medium text-ink underline underline-offset-4"
        >
          {mode === "in" ? "Criar conta" : "Entrar"}
        </button>
      </p>
    </div>
  );
}
