"use client";

import { RouteArcNav } from "@/components/route-arc-nav";
import { SAUDE_TABS } from "@/lib/saude/nav";

export function SaudeSubnav() {
  return <RouteArcNav items={SAUDE_TABS} label="Seções de Saúde" />;
}
