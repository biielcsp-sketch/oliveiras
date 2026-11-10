import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Cabeçalho padrão dos módulos (Finanças, Saúde, Casa, Igreja): painel com a imagem azul de fundo
 * (public/modulos/hero-fundo.webp) que ocupa o topo da tela (por trás da barra do topo no celular),
 * fecha em "V" com a setinha na ponta e leva o menu em ferradura.
 * A barra do topo fica clara sobre ele (ver HERO_ROUTES em src/lib/modules.ts).
 */
export function ModuleHero({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="relative -mx-5 -mt-[calc(env(safe-area-inset-top)+92px)] mb-12 md:mx-0 md:-mt-2">
      {/* Imagem recortada no formato do painel (retângulo que termina em V). O recorte usa unidades
          relativas (0 a 1) e acompanha largura e altura; a imagem cobre o painel sem distorcer. */}
      <svg aria-hidden="true" className="absolute inset-0 size-full md:rounded-t-[32px]">
        <defs>
          <clipPath id="module-hero-recorte" clipPathUnits="objectBoundingBox">
            <path d="M0 0H1V0.885C1 0.9 0.99 0.906 0.975 0.91L0.535 0.986Q0.5 0.993 0.465 0.986L0.025 0.91C0.01 0.906 0 0.9 0 0.885Z" />
          </clipPath>
        </defs>
        <image
          href="/modulos/hero-fundo.webp"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#module-hero-recorte)"
        />
      </svg>
      <div className="relative px-5 pb-12 pt-[calc(env(safe-area-inset-top)+92px)] text-white md:px-8 md:pt-7">
        <h1 className="text-glow text-center text-[34px] font-bold tracking-tight">{title}</h1>
        <div className="mt-2">{children}</div>
      </div>
      <span
        aria-hidden="true"
        className="glass-orb absolute bottom-[-18px] left-1/2 grid size-12 -translate-x-1/2 place-items-center rounded-full text-white"
      >
        <ChevronDown size={20} strokeWidth={2} />
      </span>
    </div>
  );
}
