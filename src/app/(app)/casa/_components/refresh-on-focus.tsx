"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Mudanças feitas no outro celular aparecem ao voltar para a aba/app (sem realtime nesta etapa). */
export function RefreshOnFocus({ minIntervalMs = 5000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const onBack = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < minIntervalMs) return;
      last = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [router, minIntervalMs]);
  return null;
}
