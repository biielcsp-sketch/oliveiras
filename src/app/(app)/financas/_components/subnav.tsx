"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { chipClass } from "@/components/ui";

const TABS = [
  { href: "/financas", label: "Resumo" },
  { href: "/financas/lancamentos", label: "Lançamentos" },
  { href: "/financas/orcamento", label: "Orçamento" },
  { href: "/financas/contas-a-pagar", label: "Contas a pagar" },
  { href: "/financas/metas", label: "Metas" },
  { href: "/financas/contas", label: "Contas" },
  { href: "/financas/categorias", label: "Categorias" },
  { href: "/financas/open-finance", label: "Open Finance" },
];

export function FinanceSubnav() {
  const path = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  // Com 7 abas, a ativa pode ficar fora da tela no celular
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [path]);
  return (
    <nav aria-label="Seções de Finanças" className="-mx-5 mb-6 overflow-x-auto px-5 py-2 [scrollbar-width:none] md:mx-0 md:px-0">
      <ul className="flex w-max gap-3">
        {TABS.map(({ href, label }) => {
          const active = href === "/financas" ? path === href : path === href || path.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                ref={active ? activeRef : undefined}
                aria-current={active ? "page" : undefined}
                className={chipClass(active)}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
