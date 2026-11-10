"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { signOut } from "@/app/(app)/familia/actions";

/**
 * Sair da conta. Antes de encerrar a sessão, este aparelho para de receber avisos push daquela conta:
 * cancela a assinatura local e manda o endpoint para o servidor apagar a linha (celular compartilhado ou perdido).
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    let endpoint: string | null = null;
    try {
      if ("serviceWorker" in navigator && "PushManager" in window) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          endpoint = sub.endpoint;
          await sub.unsubscribe();
        }
      }
    } catch {
      /* sem push neste aparelho: segue para sair */
    }
    await signOut(endpoint);
  }

  return (
    <Button type="button" variant="ghost" className="w-full" disabled={pending} onClick={onClick}>
      <LogOut size={16} /> Sair
    </Button>
  );
}
