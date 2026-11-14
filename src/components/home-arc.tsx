"use client";

import { ArcNav } from "@/components/arc-nav";
import { HOME_MODULES } from "@/lib/modules";

const ITEMS = HOME_MODULES.map((m) => ({ key: m.href, href: m.entry ?? m.href, label: m.label, icon: m.icon }));
const AGENDA = ITEMS.findIndex((i) => i.href === "/agenda");

/**
 * Arco do Início: a mesma ferradura dos módulos (3 bolhas visíveis, a do meio destacada), começando na Agenda.
 * São atalhos, não abas: tocar abre o módulo; arrastar só desliza e centraliza.
 */
export function HomeArc({ className }: { className?: string }) {
  return <ArcNav items={ITEMS} active={-1} fallback={AGENDA < 0 ? 0 : AGENDA} slideOnly label="Módulos" className={className} />;
}
