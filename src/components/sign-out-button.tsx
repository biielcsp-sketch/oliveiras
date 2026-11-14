"use client";

import { useState } from "react";
import { ChevronRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { signOut } from "@/app/(app)/familia/actions";

/**
 * Sair da conta. Antes de encerrar a sessão, este aparelho para de receber avisos push daquela conta:
 * cancela a assinatura local e manda o endpoint para o servidor apagar a linha (celular compartilhado ou perdido).
 */
export function SignOutButton({ variant = "button" }: { variant?: "button" | "row" }) {
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

  if (variant === "row") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        aria-busy={pending || undefined}
        className="flex min-h-12 w-full items-center gap-3.5 px-1 py-3 text-left text-[14px] font-medium text-danger disabled:opacity-60"
      >
        <LogOut size={20} aria-hidden />
        <span className="flex-1">Sair da conta</span>
        <ChevronRight size={18} className="text-muted" aria-hidden />
      </button>
    );
  }
  return (
    <Button type="button" variant="ghost" className="w-full" disabled={pending} onClick={onClick}>
      <LogOut size={16} /> Sair
    </Button>
  );
}
