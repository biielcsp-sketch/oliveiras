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
    <div className="flex flex-col gap-4">
      {notice && (
        <p role="status" className="ls-notice">
          {notice}
        </p>
      )}
      <p className="text-center text-base text-ink">
        Olá, <span className="font-medium">{maskEmail(email)}</span>
      </p>
      <PasskeySignIn prominent autoPrompt />
      <div className="ls-soft flex flex-col items-center gap-3 text-sm">
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
