"use client";

import { useEffect } from "react";
// Começa a escutar o pedido de instalação em qualquer tela (ver src/lib/install-events.ts).
import "@/lib/install-events";

export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
  }, []);
  return null;
}
