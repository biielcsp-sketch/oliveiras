"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_COLOR, THEME_COOKIE, nextTheme, parseTheme, type Theme } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    mq.removeEventListener("change", onChange);
    mo.disconnect();
  };
}

function currentTheme(): Theme {
  return parseTheme(document.documentElement.dataset.theme) ?? (window.matchMedia(DARK_QUERY).matches ? "dark" : "light");
}

/** Alterna claro/escuro e guarda a escolha num cookie lido pelo servidor (sem script inline). */
export function ThemeToggle({ className, children }: { className?: string; children?: (theme: Theme | null) => ReactNode }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => null);
  const target = theme ? nextTheme(theme) : null;

  function toggle() {
    const next = nextTheme(currentTheme());
    document.documentElement.dataset.theme = next;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[next]));
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-label={target === "light" ? "Mudar para o modo claro" : "Mudar para o modo escuro"}
      data-theme-current={theme ?? undefined}
    >
      {children ? children(theme) : theme === "dark" ? <Sun size={22} strokeWidth={1.8} aria-hidden /> : <Moon size={22} strokeWidth={1.8} aria-hidden />}
    </button>
  );
}
