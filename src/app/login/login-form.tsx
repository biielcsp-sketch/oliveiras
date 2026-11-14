"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signIn, signUp, type AuthState } from "./actions";
import { PasskeySignIn } from "./passkey-sign-in";

export function LoginForm({ notice, defaultEmail, remembered = false }: { notice?: string; defaultEmail?: string; remembered?: boolean }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [inState, inAction, inPending] = useActionState<AuthState, FormData>(signIn, null);
  const [upState, upAction, upPending] = useActionState<AuthState, FormData>(signUp, null);
  const state = mode === "in" ? inState : upState;
  const pending = inPending || upPending;

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p role="status" className="ls-notice">
          {notice}
        </p>
      )}

      <form action={mode === "in" ? inAction : upAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="ls-label">E-mail</span>
          <input name="email" type="email" autoComplete="email" defaultValue={defaultEmail} required className="ls-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ls-label">Senha</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            minLength={mode === "up" ? 8 : undefined}
            required
            className="ls-input"
          />
        </label>
        {mode === "in" && (
          <div className="ls-soft flex items-center justify-between gap-3 px-2 text-[13px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="remember" defaultChecked={remembered} className="h-4 w-4 accent-[var(--primary)]" />
              Lembrar neste aparelho
            </label>
            <Link href="/esqueci-senha" className="underline underline-offset-4">
              Esqueci minha senha
            </Link>
          </div>
        )}
        {state?.error && <p className="ls-error">{state.error}</p>}
        {state?.info && <p className="ls-soft text-sm">{state.info}</p>}
        <button type="submit" disabled={pending} className="ls-btn ls-btn--primary transition active:scale-[0.98] disabled:opacity-50">
          {pending ? "Aguarde…" : mode === "in" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      {mode === "in" && <PasskeySignIn />}

      <p className="ls-soft text-center text-sm">
        {mode === "in" ? "Não tem conta? " : "Já tem conta? "}
        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="ls-link underline underline-offset-4"
        >
          {mode === "in" ? "Criar conta" : "Entrar"}
        </button>
      </p>
    </div>
  );
}
