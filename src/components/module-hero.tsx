import type { ReactNode } from "react";
import { HeadBar } from "@/components/head-bar";
import { HeroBackground } from "@/components/hero-background";

/**
 * Cabeçalho padrão dos módulos (Finanças, Saúde, Casa, Igreja): painel azul (o mesmo fundo e onda do Início, altura fixa)
 * com o topo (tema, logo centralizado e família) no celular, o título e o menu em ferradura.
 */
export function ModuleHero({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="relative -mx-4 -mt-[calc(env(safe-area-inset-top)+12px)] mb-4 h-[calc(350px+env(safe-area-inset-top))] overflow-hidden text-white md:mx-0 md:mt-0 md:h-[350px] md:rounded-[32px]">
      <HeroBackground />
      <div className="relative px-4 pt-[calc(env(safe-area-inset-top)+14px)] md:px-8 md:pt-7">
        <HeadBar />
        <h1 className="text-on-image mt-3 text-center text-[28px] font-semibold tracking-tight md:mt-0">{title}</h1>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}
