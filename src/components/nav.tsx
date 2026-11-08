"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { CalendarDays, Mic, Moon, Sun } from "lucide-react";
import {
  AGENDA,
  ASSISTANT,
  FAMILY,
  HOME,
  MOBILE_NAV_LEFT,
  MOBILE_NAV_RIGHT,
  SIDEBAR_NAV,
  type ModuleDef,
} from "@/lib/modules";
import { Logo } from "@/components/logo";
import { AgendaCalendarButton } from "@/components/agenda-calendar";
import { ThemeToggle } from "@/components/theme-toggle";

function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

const sideItem =
  "flex h-11 w-full items-center gap-3 rounded-full px-4 text-[15px] transition";

/** Barra lateral no desktop. */
export function Sidebar({ familyName }: { familyName: string }) {
  const path = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col px-4 py-6 md:flex">
      <div className="glass flex h-full flex-col rounded-[24px] p-3 shadow-card">
        <Link href={HOME.href} aria-label="Oliveira's, ir para o Início" className="rounded-2xl px-2 pt-2">
          <Logo />
          <p className="mt-1 pl-[42px] text-xs text-muted">{familyName}</p>
        </Link>
        <nav aria-label="Principal" className="mt-8 flex flex-1 flex-col gap-1">
          {SIDEBAR_NAV.map(({ href, label, icon: Icon }: ModuleDef) => {
            const active = isActive(path, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  sideItem,
                  active ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-primary" : undefined} />
                {label}
              </Link>
            );
          })}
          <AgendaCalendarButton className={clsx(sideItem, "text-muted hover:bg-surface-2 hover:text-ink")}>
            <AGENDA.icon size={20} strokeWidth={1.8} aria-hidden />
            {AGENDA.label}
          </AgendaCalendarButton>
          <ThemeToggle className={clsx(sideItem, "text-muted hover:bg-surface-2 hover:text-ink")}>
            {(theme) => (
              <>
                {theme === "dark" ? <Sun size={20} strokeWidth={1.8} aria-hidden /> : <Moon size={20} strokeWidth={1.8} aria-hidden />}
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </>
            )}
          </ThemeToggle>
        </nav>
        <Link
          href={FAMILY.href}
          aria-current={isActive(path, FAMILY.href) ? "page" : undefined}
          className={clsx(
            sideItem,
            isActive(path, FAMILY.href) ? "bg-accent-soft font-medium" : "text-muted hover:bg-surface-2 hover:text-ink",
          )}
        >
          <FAMILY.icon size={20} strokeWidth={1.8} />
          {FAMILY.label}
        </Link>
      </div>
    </aside>
  );
}

function TabLink({ item, path }: { item: ModuleDef; path: string }) {
  const active = isActive(path, item.href);
  const Icon = item.icon;
  return (
    <li className="flex-1">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "flex h-14 flex-col items-center justify-center gap-1 text-[13px] transition",
          active ? "font-medium text-primary" : "text-muted hover:text-ink",
        )}
      >
        <Icon size={22} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
        {item.label}
      </Link>
    </li>
  );
}

/** Barra inferior no celular: faixa em onda com o botão do Oli elevado no centro. */
export function BottomNav() {
  const path = usePathname();
  const oliActive = isActive(path, ASSISTANT.href);
  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 md:hidden">
      <div className="relative mx-auto max-w-lg">
        {/* Faixa: sobe nas laterais e afunda no centro */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full drop-shadow-[0_-6px_16px_rgb(20_40_60/0.08)]"
          viewBox="0 0 390 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="bottom-nav-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="nav-stop-to" />
              <stop offset="1" className="nav-stop-from" />
            </linearGradient>
          </defs>
          <path d="M0 2 C70 2 120 26 195 26 C270 26 320 2 390 2 L390 100 L0 100 Z" fill="url(#bottom-nav-fill)" />
        </svg>
        <div className="safe-bottom relative">
          <ul className="flex items-end px-2 pb-2 pt-7">
            {MOBILE_NAV_LEFT.map((item) => (
              <TabLink key={item.href} item={item} path={path} />
            ))}
            <li className="flex w-[84px] shrink-0 justify-center">
              <Link
                href={ASSISTANT.href}
                aria-label="Oli, assistente"
                aria-current={oliActive ? "page" : undefined}
                className="bg-hero -mt-12 grid size-16 place-items-center rounded-full text-on-primary shadow-soft ring-[6px] ring-[var(--nav-ring)] transition active:scale-95"
              >
                <Mic size={26} strokeWidth={2} aria-hidden />
              </Link>
            </li>
            {MOBILE_NAV_RIGHT.map((item) => (
              <TabLink key={item.href} item={item} path={path} />
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}

const roundBtn =
  "grid size-12 place-items-center rounded-full bg-surface-solid text-ink shadow-round transition hover:text-primary active:scale-95";

/** Topo no celular: logo (→ Início) + Agenda (calendário) e Família. */
export function MobileTopBar() {
  return (
    <header className="flex items-center justify-between px-5 pb-2 pt-[calc(env(safe-area-inset-top)+16px)] md:hidden">
      <Link href={HOME.href} aria-label="Oliveira's, ir para o Início" className="rounded-2xl">
        <Logo />
      </Link>
      <div className="flex items-center gap-3">
        <ThemeToggle className={roundBtn} />
        <AgendaCalendarButton className={roundBtn}>
          <CalendarDays size={22} strokeWidth={1.8} aria-hidden />
        </AgendaCalendarButton>
        <Link href={FAMILY.href} aria-label="Família" className={roundBtn}>
          <FAMILY.icon size={22} strokeWidth={1.8} aria-hidden />
        </Link>
      </div>
    </header>
  );
}
