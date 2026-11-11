"use client";

import { Home, ListChecks, Package, ShoppingCart, Wrench } from "lucide-react";
import { RouteArcNav } from "@/components/route-arc-nav";

const TABS = [
  { key: "resumo", href: "/casa", label: "Resumo", icon: Home },
  { key: "compras", href: "/casa/compras", label: "Compras", icon: ShoppingCart },
  { key: "despensa", href: "/casa/despensa", label: "Despensa", icon: Package },
  { key: "tarefas", href: "/casa/tarefas", label: "Tarefas", icon: ListChecks },
  { key: "manutencao", href: "/casa/manutencao", label: "Manutenção", icon: Wrench },
];

export function CasaSubnav() {
  return <RouteArcNav items={TABS} label="Seções de Casa" />;
}
