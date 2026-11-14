"use client";

import { ArcNav } from "@/components/arc-nav";
import { useHomeCenter } from "@/components/home-center";
import { HOME_MODULES } from "@/lib/modules";

const ITEMS = HOME_MODULES.map((m) => ({ key: m.href, href: m.entry ?? m.href, label: m.label, icon: m.icon }));

/**
 * Arco do Início: a mesma ferradura dos módulos (3 bolhas visíveis, a do meio destacada), começando na Agenda.
 * São atalhos, não abas: tocar abre o módulo; arrastar (ou as setas) só desliza e centraliza, e o resumo
 * abaixo (HomePanels) acompanha o item do centro.
 */
export function HomeArc({ className }: { className?: string }) {
  const { index, setIndex } = useHomeCenter();
  return <ArcNav items={ITEMS} active={-1} fallback={index} slideOnly onCenter={setIndex} label="Módulos" className={className} />;
}
