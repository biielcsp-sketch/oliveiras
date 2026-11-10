import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Cabeçalho padrão dos módulos (Finanças, Saúde, Casa, Igreja): painel azul que ocupa o topo da tela
 * (por trás da barra do topo no celular), fecha em "V" com a setinha na ponta e leva o menu em ferradura.
 * A barra do topo fica clara sobre ele (ver HERO_ROUTES em src/lib/modules.ts).
 */
export function ModuleHero({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="relative -mx-5 -mt-[calc(env(safe-area-inset-top)+92px)] mb-12 md:mx-0 md:-mt-2">
      <div className="hero-panel px-5 pb-2 pt-[calc(env(safe-area-inset-top)+92px)] text-white md:rounded-t-[32px] md:px-8 md:pt-7">
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        <div className="mt-2">{children}</div>
      </div>
      {/* Ponta em V (a curva acompanha a largura da tela) */}
      <svg aria-hidden="true" className="block h-10 w-full" viewBox="0 0 390 40" preserveAspectRatio="none">
        <path d="M0 0H390V4C390 12 385 16 377 18L207 38Q195 41 183 38L13 18C5 16 0 12 0 4Z" fill="var(--hero-to)" />
      </svg>
      <span
        aria-hidden="true"
        className="absolute bottom-[-18px] left-1/2 grid size-12 -translate-x-1/2 place-items-center rounded-full bg-[var(--hero-to)] text-white"
      >
        <ChevronDown size={20} strokeWidth={2} />
      </span>
    </div>
  );
}
