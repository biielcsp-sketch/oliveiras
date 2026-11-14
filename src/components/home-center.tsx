"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { HOME_PANEL_INFO, homePanelAt, type HomePanelKey } from "@/lib/home-panels";

type Ctx = { index: number; setIndex: (i: number) => void };
const HomeCenterCtx = createContext<Ctx | null>(null);

/** Guarda qual item do arco do Início está no centro; o arco escreve, o painel de resumo lê. */
export function HomeCenterProvider({ initial, children }: { initial: number; children: ReactNode }) {
  const [index, setIndex] = useState(initial);
  return <HomeCenterCtx.Provider value={{ index, setIndex }}>{children}</HomeCenterCtx.Provider>;
}

export function useHomeCenter() {
  const ctx = useContext(HomeCenterCtx);
  if (!ctx) throw new Error("useHomeCenter fora do HomeCenterProvider");
  return ctx;
}

/**
 * Resumo do item centralizado no arco: troca sozinho quando o centro muda (sem clique), com transição suave
 * (desligada com movimento reduzido). Todos os resumos já vêm do servidor; aqui só se escolhe qual mostrar.
 */
export function HomePanels({ panels }: { panels: Record<HomePanelKey, ReactNode> }) {
  const { index } = useHomeCenter();
  const current = homePanelAt(index);
  const info = HOME_PANEL_INFO[current];
  return (
    <section aria-live="polite" aria-labelledby="home-panel-title" className="flex flex-col gap-3" data-testid="home-panel" data-panel={current}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-panel-title" className="text-[15.5px] font-semibold tracking-tight">
          {info.title}
        </h2>
        <Link href={info.href} className="inline-flex min-h-11 shrink-0 items-center gap-0.5 text-[13px] font-medium text-link hover:text-deep">
          {info.link}
          <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
        </Link>
      </div>
      {(Object.keys(panels) as HomePanelKey[]).map((k) => (
        <div key={k} hidden={k !== current} className={clsx("flex flex-col gap-3.5", k === current && "home-panel-in")} data-panel-body={k}>
          {panels[k]}
        </div>
      ))}
    </section>
  );
}
