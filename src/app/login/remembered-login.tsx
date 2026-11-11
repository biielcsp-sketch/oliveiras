"use client";

import { useState, useSyncExternalStore } from "react";
import { forgetDevice } from "./actions";
import { LoginForm } from "./login-form";
import { PasskeySignIn } from "./passkey-sign-in";
import { maskEmail } from "@/lib/remember";

const subscribe = () => () => {};

/** Tela de usuário lembrado: pede só a digital. Sem WebAuthn, cai direto no formulário com o e-mail. */
export function RememberedLogin({ email, notice }: { email: string; notice?: string }) {
  const [usePassword, setUsePassword] = useState(false);
  // Servidor assume suporte (evita piscar o formulário); no navegador sem WebAuthn troca para o formulário.
  const supported = useSyncExternalStore(subscribe, () => "PublicKeyCredential" in window, () => true);

  if (usePassword || !supported) return <LoginForm notice={notice} defaultEmail={email} remembered />;

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p role="status" className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      )}
      <p className="text-center text-base">
        Olá, <span className="font-medium">{maskEmail(email)}</span>
      </p>
      <PasskeySignIn prominent autoPrompt />
      <div className="flex flex-col items-center gap-3 text-sm text-muted">
        <button type="button" onClick={() => setUsePassword(true)} className="underline underline-offset-4">
          Usar a senha
        </button>
        <form action={forgetDevice}>
          <button type="submit" className="underline underline-offset-4">
            Não sou eu / Esquecer este aparelho
          </button>
        </form>
      </div>
    </div>
  );
}
