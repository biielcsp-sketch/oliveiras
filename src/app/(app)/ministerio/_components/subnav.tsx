"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RouteArcNav } from "@/components/route-arc-nav";
import { chipClass } from "@/components/ui";
import { DEVOCIONAL_TABS, devocionalTabFor, IGREJA_TABS } from "@/lib/igreja/nav";

export function IgrejaSubnav() {
  return <RouteArcNav items={IGREJA_TABS} label="Seções de Igreja" />;
}

/** Abas internas da Vida Devocional (cada uma é uma página). */
export function DevocionalTabs() {
  const active = devocionalTabFor(usePathname());
  return (
    <nav aria-label="Vida devocional" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {DEVOCIONAL_TABS.map((t) => (
        <Link key={t.key} href={t.href} className={chipClass(t.key === active)} aria-current={t.key === active ? "page" : undefined} scroll={false}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
