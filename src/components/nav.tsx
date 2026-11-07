"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ASSISTANT, FAMILY, HOME, MOBILE_NAV, MODULES, type ModuleDef } from "@/lib/modules";
import { Logo } from "@/components/logo";

function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

/** Barra lateral no desktop. */
export function Sidebar({ familyName }: { familyName: string }) {
  const path = usePathname();
  const items: ModuleDef[] = [HOME, ...MODULES, ASSISTANT];

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line px-4 py-6 md:flex">
      <div className="px-2">
        <Logo />
        <p className="mt-1 pl-[38px] text-xs text-muted">{familyName}</p>
      </div>
      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition",
              isActive(path, href)
                ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]"
                : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon size={18} strokeWidth={1.8} />
            {label}
          </Link>
        ))}
      </nav>
      <Link
        href={FAMILY.href}
        className={clsx(
          "flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition",
          isActive(path, FAMILY.href) ? "bg-surface font-medium" : "text-muted hover:bg-surface-2",
        )}
      >
        <FAMILY.icon size={18} strokeWidth={1.8} />
        {FAMILY.label}
      </Link>
    </aside>
  );
}

/** Barra inferior no celular. */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 backdrop-blur-xl md:hidden">
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={clsx(
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px] transition",
                  active ? "font-medium text-ink" : "text-muted",
                )}
              >
                <Icon size={21} strokeWidth={active ? 2.2 : 1.7} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Topo no celular: logo + atalhos para assistente e família. */
export function MobileTopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg/90 px-4 backdrop-blur-xl md:hidden">
      <Link href="/inicio">
        <Logo />
      </Link>
      <div className="flex items-center gap-1">
        <Link
          href={ASSISTANT.href}
          aria-label="Assistente"
          className="grid size-10 place-items-center rounded-xl text-olive hover:bg-surface-2"
        >
          <ASSISTANT.icon size={20} />
        </Link>
        <Link
          href={FAMILY.href}
          aria-label="Família"
          className="grid size-10 place-items-center rounded-xl text-muted hover:bg-surface-2"
        >
          <FAMILY.icon size={20} />
        </Link>
      </div>
    </header>
  );
}
