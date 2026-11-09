"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { chipClass } from "@/components/ui";

const TABS = [
  { href: "/saude", label: "Carteirinhas" },
  { href: "/saude/consultas", label: "Consultas" },
  { href: "/saude/exames", label: "Exames" },
  { href: "/saude/procedimentos", label: "Procedimentos" },
  { href: "/saude/medicamentos", label: "Medicamentos" },
  { href: "/saude/vacinas", label: "Vacinas" },
];

export function SaudeSubnav() {
  const path = usePathname();
  return (
    <nav aria-label="Seções de Saúde" className="-mx-5 mb-6 overflow-x-auto px-5 py-2 [scrollbar-width:none] md:mx-0 md:px-0">
      <ul className="flex w-max gap-3">
        {TABS.map(({ href, label }) => {
          const active = href === "/saude" ? path === href : path === href || path.startsWith(href + "/");
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined} className={chipClass(active)}>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
