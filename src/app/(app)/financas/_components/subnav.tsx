"use client";

import { ArrowLeftRight, Banknote, CalendarClock, ChartPie, Landmark, LayoutDashboard, Tags, Target } from "lucide-react";
import { RouteArcNav } from "@/components/route-arc-nav";

// Resumo no meio: ao abrir Finanças ele fica no centro, com botões dos dois lados
const TABS = [
  { key: "lancamentos", href: "/financas/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
  { key: "orcamento", href: "/financas/orcamento", label: "Orçamento", icon: ChartPie },
  { key: "resumo", href: "/financas", label: "Resumo", icon: LayoutDashboard },
  { key: "contas-a-pagar", href: "/financas/contas-a-pagar", label: "Contas a pagar", icon: CalendarClock },
  { key: "metas", href: "/financas/metas", label: "Metas", icon: Target },
  { key: "contas", href: "/financas/contas", label: "Contas", icon: Banknote },
  { key: "categorias", href: "/financas/categorias", label: "Categorias", icon: Tags },
  { key: "open-finance", href: "/financas/open-finance", label: "Open Finance", icon: Landmark },
];

export function FinanceSubnav() {
  return <RouteArcNav items={TABS} label="Seções de Finanças" />;
}
