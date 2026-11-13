"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
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
import { OliSphere } from "@/components/oli/oli-sphere";

function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

const sideItem = "flex h-11 w-full items-center gap-3 rounded-full px-4 text-[15px] font-medium transition";
const sideIdle = "text-ink/80 hover:bg-accent-soft hover:text-deep";
const sideOn = "bg-accent-soft font-semibold text-deep";

/** Barra lateral no desktop: vidro, item ativo em azul. */
export function Sidebar({ familyName }: { familyName: string }) {
  const path = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col px-4 py-6 md:flex">
      <div className="glass-card flex h-full flex-col rounded-[26px] p-3">
        <Link href={HOME.href} aria-label="Oliveira's, ir para o Início" className="rounded-2xl px-2 pt-2">
          <Logo />
          <p className="mt-1 pl-[44px] text-xs text-muted">{familyName}</p>
        </Link>
        <nav aria-label="Principal" className="mt-8 flex flex-1 flex-col gap-1">
          {SIDEBAR_NAV.map(({ href, entry, label, icon: Icon }: ModuleDef) => {
            const active = isActive(path, href);
            const oli = href === ASSISTANT.href;
            return (
              <Link
                key={href}
                href={entry ?? href}
                aria-current={active ? "page" : undefined}
                className={clsx(sideItem, active ? sideOn : sideIdle)}
              >
                {oli ? (
                  <OliSphere size={22} />
                ) : (
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-primary" : undefined} aria-hidden />
                )}
                {label}
              </Link>
            );
          })}
          <AgendaCalendarButton className={clsx(sideItem, sideIdle)}>
            <AGENDA.icon size={20} strokeWidth={1.8} aria-hidden />
            {AGENDA.label}
          </AgendaCalendarButton>
          <ThemeToggle className={clsx(sideItem, sideIdle)}>
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
          className={clsx(sideItem, isActive(path, FAMILY.href) ? sideOn : sideIdle)}
        >
          <FAMILY.icon size={20} strokeWidth={1.8} aria-hidden />
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
        href={item.entry ?? item.href}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "mx-auto grid h-12 w-full max-w-16 place-items-center rounded-2xl transition",
          active ? "text-primary" : "text-ink/85 hover:text-primary",
        )}
      >
        <Icon size={23} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
      </Link>
    </li>
  );
}

/**
 * Barra inferior no celular: vidro flutuante (12px das laterais, 14px do fundo, raio 26, altura 62), só ícones.
 * No centro, a esfera do Oli elevada com halo leva à tela do assistente.
 */
export function BottomNav() {
  const path = usePathname();
  const oliActive = isActive(path, ASSISTANT.href);
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-3 bottom-[calc(14px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-lg md:hidden"
    >
      <ul className="glass-card flex h-[62px] items-center rounded-[26px] px-1.5">
        {MOBILE_NAV_LEFT.map((item) => (
          <TabLink key={item.href} item={item} path={path} />
        ))}
        <li className="flex w-[84px] shrink-0 justify-center">
          <Link
            href={ASSISTANT.href}
            aria-label="Oli, o assistente"
            aria-current={oliActive ? "page" : undefined}
            className="oli-dock"
          >
            <OliSphere size={54} />
          </Link>
        </li>
        {MOBILE_NAV_RIGHT.map((item) => (
          <TabLink key={item.href} item={item} path={path} />
        ))}
      </ul>
    </nav>
  );
}
