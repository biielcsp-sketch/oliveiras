"use client";

import { useState } from "react";
import {
  BookOpen,
  CalendarClock,
  FileText,
  HeartHandshake,
  ListChecks,
  Phone,
  Receipt,
  ShoppingCart,
  Users,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { MODULES } from "@/lib/modules";
import { ArcNav } from "@/components/arc-nav";
import { ModuleHero } from "@/components/module-hero";
import { Card, Tag } from "@/components/ui";

type Planned = { key: string; label: string; detail: string; icon: LucideIcon };

/** O que vai ter em cada módulo ainda não construído (botões da ferradura). */
const PLANNED: Record<"casa" | "ministerio", Planned[]> = {
  casa: [
    { key: "compras", label: "Compras", detail: "Lista de compras", icon: ShoppingCart },
    { key: "tarefas", label: "Tarefas", detail: "Tarefas domésticas com rodízio", icon: ListChecks },
    { key: "manutencao", label: "Manutenção", detail: "Manutenção recorrente", icon: Wrench },
    { key: "contas", label: "Contas fixas", detail: "Contas fixas da casa", icon: Receipt },
    { key: "documentos", label: "Documentos", detail: "Documentos e garantias", icon: FileText },
    { key: "cardapio", label: "Cardápio", detail: "Cardápio da semana", icon: UtensilsCrossed },
    { key: "prestadores", label: "Prestadores", detail: "Contatos de prestadores", icon: Phone },
  ],
  ministerio: [
    { key: "escalas", label: "Escalas", detail: "Escalas de serviço (vão para a agenda)", icon: CalendarClock },
    { key: "pessoas", label: "Pessoas", detail: "Pessoas acompanhadas e follow-up", icon: Users },
    { key: "consolidacao", label: "Consolidação e GC", detail: "Consolidação e GC", icon: HeartHandshake },
    { key: "estudos", label: "Estudos", detail: "Estudos, materiais e anotações", icon: BookOpen },
  ],
};

/** Tela de módulo ainda não construído: ferradura com o que vai ter e em qual fase entra. */
export function ModulePlaceholder({ module: key }: { module: "casa" | "ministerio" }) {
  const mod = MODULES.find((m) => m.href === `/${key}`)!;
  const items = PLANNED[key];
  const [active, setActive] = useState(0);
  const item = items[active];
  const Icon = item.icon;
  return (
    <>
      <ModuleHero title={mod.label}>
        <ArcNav items={items} active={active} onChange={setActive} label={`Seções de ${mod.label}`} />
      </ModuleHero>
      <Card className="flex flex-col items-start gap-4" aria-live="polite">
        <div className="flex w-full items-start justify-between gap-3">
          <span className="grid size-12 place-items-center rounded-full border border-line bg-accent-soft text-primary">
            <Icon size={22} aria-hidden />
          </span>
          <Tag>Fase {mod.phase}</Tag>
        </div>
        <div>
          <p className="text-lg font-semibold tracking-tight">{item.detail}</p>
          <p className="mt-1 text-sm text-muted">Chega na fase {mod.phase}.</p>
        </div>
      </Card>
    </>
  );
}
