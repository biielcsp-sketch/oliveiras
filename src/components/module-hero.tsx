import type { ReactNode } from "react";
import { HeroDrawerButton } from "@/components/hero-drawer";
import { HeadBar } from "@/components/head-bar";

/**
 * Fundo do cabeçalho: gradiente azul suave com um clarão discreto e onda que desce até a ponta (onde fica a setinha).
 * Só decoração; estica com a altura do conteúdo.
 */
function HeroBackground() {
  return (
    <svg aria-hidden="true" className="absolute inset-0 size-full md:rounded-t-[32px]" viewBox="0 0 390 360" preserveAspectRatio="none">
      <defs>
        <linearGradient id="module-hero-bg" x1="0" y1="0" x2=".2" y2="1">
          <stop offset="0" stopColor="#0A44A8" />
          <stop offset="1" stopColor="#2A6BD0" />
        </linearGradient>
        <radialGradient id="module-hero-glow" cx=".9" cy=".25" r=".55">
          <stop offset="0" stopColor="#9CC4FF" stopOpacity=".22" />
          <stop offset="1" stopColor="#9CC4FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Onda: laterais um pouco mais altas, desce em curva suave até a ponta central */}
      <path d="M0 0H390V318C346 312 300 322 252 336Q214 348 195 350Q176 348 138 336C90 322 44 312 0 318Z" fill="url(#module-hero-bg)" />
      <path d="M0 0H390V318C346 312 300 322 252 336Q214 348 195 350Q176 348 138 336C90 322 44 312 0 318Z" fill="url(#module-hero-glow)" />
    </svg>
  );
}

/**
 * Cabeçalho padrão dos módulos (Finanças, Saúde, Casa, Igreja): painel azul em gradiente que ocupa o topo da tela,
 * com o topo (tema, logo centralizado e família) no celular, o título e o menu em ferradura.
 * Fecha em onda com a setinha na ponta, que abre o HeroDrawer da página, se houver (`drawerLabel` nomeia o conteúdo).
 */
export function ModuleHero({ title, drawerLabel, children }: { title: string; drawerLabel?: string; children?: ReactNode }) {
  return (
    <div className="relative -mx-4 -mt-[calc(env(safe-area-inset-top)+12px)] mb-10 text-white md:mx-0 md:mt-0">
      <HeroBackground />
      <div className="relative px-4 pb-12 pt-[calc(env(safe-area-inset-top)+14px)] md:px-8 md:pt-7">
        <HeadBar />
        <h1 className="text-on-image mt-3 text-center text-[28px] font-semibold tracking-tight md:mt-0">{title}</h1>
        <div className="mt-1">{children}</div>
      </div>
      <HeroDrawerButton label={drawerLabel ?? `detalhes de ${title}`} />
    </div>
  );
}
