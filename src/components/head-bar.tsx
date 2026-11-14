"use client";

import Link from "next/link";
import { Moon, Sun, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { TapArea } from "@/components/ui";

/** Botão redondo do topo: 36px visíveis, área de toque de 44px pelo TapArea. */
const headBtn = "glass-clear relative grid size-9 place-items-center rounded-full transition hover:brightness-110 active:scale-95";

/**
 * Topo do cabeçalho azul (Início e módulos) no celular: tema à esquerda, logo centralizado e família à direita.
 * A Agenda fica no arco do Início; no desktop, logo, tema, agenda e família ficam na barra lateral.
 */
export function HeadBar({ className }: { className?: string }) {
  return (
    <div className={`grid grid-cols-[44px_1fr_44px] items-center md:hidden ${className ?? ""}`}>
      <div className="grid place-items-center">
        <ThemeToggle className={headBtn}>
          {(theme) => (
            <>
              <TapArea />
              {theme === "dark" ? <Sun size={17} strokeWidth={1.8} aria-hidden /> : <Moon size={17} strokeWidth={1.8} aria-hidden />}
            </>
          )}
        </ThemeToggle>
      </div>
      <Link href="/inicio" aria-label="Oliveira's, ir para o Início" className="justify-self-center rounded-2xl text-white" data-testid="head-logo">
        <Logo inverted size={28} />
      </Link>
      <div className="grid place-items-center">
        <Link href="/familia" aria-label="Família" className={headBtn}>
          <TapArea />
          <Users size={17} strokeWidth={1.8} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
