"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { Button, FormError } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { signInErrorMessage } from "@/lib/passkey-errors";
import { useWebAuthnSupport } from "@/lib/use-webauthn-support";

/** "Entrar com digital": só aparece se o navegador suporta WebAuthn. */
export function PasskeySignIn() {
  const router = useRouter();
  const supported = useWebAuthnSupport();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supported) return null;

  async function handleClick() {
    setPending(true);
    setError(null);
    const { data, error } = await createClient().auth.signInWithPasskey();
    if (error || !data?.session) {
      setError(signInErrorMessage(error));
      setPending(false);
      return;
    }
    router.replace("/inicio");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[13px] text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button type="button" variant="ghost" onClick={handleClick} disabled={pending}>
        <Fingerprint size={18} aria-hidden />
        {pending ? "Aguarde…" : "Entrar com digital"}
      </Button>
      <div role="status" aria-live="polite">
        <FormError message={error} />
      </div>
    </div>
  );
}
