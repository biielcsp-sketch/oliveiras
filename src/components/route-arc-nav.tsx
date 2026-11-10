"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { ArcNav, type ArcItem } from "@/components/arc-nav";
import { activeRouteIndex } from "@/lib/arc-nav";

type RouteItem = ArcItem & { href: string };

/** Ferradura de abas que são páginas: o botão que para no centro abre a página dele. */
export function RouteArcNav({ items, label }: { items: RouteItem[]; label: string }) {
  const path = usePathname();
  const router = useRouter();
  const active = activeRouteIndex(items, path);
  const onChange = useCallback((i: number) => router.push(items[i].href, { scroll: false }), [items, router]);
  return <ArcNav items={items} active={active} onChange={onChange} label={label} />;
}
