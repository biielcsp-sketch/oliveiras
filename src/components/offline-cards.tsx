"use client";

import { useEffect } from "react";
import { clearOfflineCards, guardOwner, syncOfflineCards, type OfflineCard } from "@/lib/saude/offline-cards";

/**
 * Sem `cards`: só garante que o cache de carteirinhas do aparelho é de quem está logado (layout do app).
 * Com `cards`: deixa o cache igual à lista atual (tela de Carteirinhas; apagar uma carteirinha remove do cache).
 */
export function OfflineCardsSync({ userId, cards }: { userId: string; cards?: OfflineCard[] }) {
  const key = cards ? JSON.stringify(cards) : "";
  useEffect(() => {
    if (typeof caches === "undefined") return;
    const list = key ? (JSON.parse(key) as OfflineCard[]) : null;
    (async () => {
      await guardOwner(caches, userId);
      if (list && navigator.onLine) await syncOfflineCards(caches, fetch, userId, list);
    })().catch(() => {});
  }, [userId, key]);
  return null;
}

/** Tela de login: sair da conta sempre cai aqui, então o cache offline de carteirinhas é apagado. */
export function OfflineCardsWipe() {
  useEffect(() => {
    if (typeof caches !== "undefined") void clearOfflineCards(caches);
  }, []);
  return null;
}
