"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { runPasskeySignIn } from "@/lib/passkey-sign-in";
import { useWebAuthnSupport } from "@/lib/use-webauthn-support";

/**
 * "Entrar com digital": só aparece se o navegador suporta WebAuthn.
 * `prominent`: botão grande e sem o "ou" (tela de usuário lembrado).
 * `autoPrompt`: pede a digital uma única vez ao abrir; bloqueio ou cancelamento ficam em silêncio.
 */
export function PasskeySignIn({ prominent = false, autoPrompt = false }: { prominent?: boolean; autoPrompt?: boolean }) {
  const router = useRouter();
  const supported = useWebAuthnSupport();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asked = useRef(false);

  async function start(silent: boolean) {
    setPending(true);
    setError(null);
    // Cliente do Supabase (+ WebAuthn, ~70 KB) só é baixado quando a digital é usada: fora do caminho do primeiro paint.
    const outcome = await runPasskeySignIn(() => import("@/lib/supabase/browser").then((m) => m.createClient()), silent);
    if (!outcome.ok) {
      if (outcome.message) setError(outcome.message);
      setPending(false);
      return;
    }
    router.replace("/inicio");
    router.refresh();
  }

  useEffect(() => {
    if (!autoPrompt || !supported || asked.current) return;
    asked.current = true; // uma vez só, nunca em laço
    void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, supported]);

  if (!supported) return null;

  const handleClick = () => start(false);

  return (
    <div className="flex flex-col gap-3">
      {!prominent && (
        <div className="flex items-center gap-3 ls-soft text-[13px]" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          ou
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`ls-btn ${prominent ? "ls-btn--primary ls-btn--tall text-base" : "ls-btn--glass"} inline-flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:opacity-50`}
      >
        <Fingerprint size={18} aria-hidden />
        {pending ? "Aguarde…" : "Entrar com digital"}
      </button>
      <div role="status" aria-live="polite">
        {error && <p className="ls-error">{error}</p>}
      </div>
    </div>
  );
}
