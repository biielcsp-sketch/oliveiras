"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { Button, FormError } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { signInErrorMessage } from "@/lib/passkey-errors";
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
    const { data, error } = await createClient().auth.signInWithPasskey();
    if (error || !data?.session) {
      if (!silent) setError(signInErrorMessage(error));
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
        <div className="flex items-center gap-3 text-[13px] text-muted" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          ou
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
      <Button type="button" variant={prominent ? "primary" : "ghost"} onClick={handleClick} disabled={pending} className={prominent ? "h-14 text-base" : undefined}>
        <Fingerprint size={18} aria-hidden />
        {pending ? "Aguarde…" : "Entrar com digital"}
      </Button>
      <div role="status" aria-live="polite">
        <FormError message={error} />
      </div>
    </div>
  );
}
