"use client";

import { RouteArcNav } from "@/components/route-arc-nav";
import { FINANCAS_TABS } from "@/lib/financas/nav";

export function FinanceSubnav() {
  return <RouteArcNav items={FINANCAS_TABS} label="Seções de Finanças" />;
}
