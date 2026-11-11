"use client";

import { RouteArcNav } from "@/components/route-arc-nav";
import { CASA_TABS } from "@/lib/casa/nav";

export function CasaSubnav() {
  return <RouteArcNav items={CASA_TABS} label="Seções de Casa" />;
}
