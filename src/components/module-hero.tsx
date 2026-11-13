import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, Users } from "lucide-react";
import { HeroDrawerButton } from "@/components/hero-drawer";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AgendaCalendarButton } from "@/components/agenda-calendar";

/** Botões redondos de vidro do topo (tema, agenda, família): mesmo estilo do cabeçalho do Início. */
const headBtn = "glass-clear grid size-11 place-items-center rounded-full transition hover:brightness-110 active:scale-95";

/**
 * Fundo do cabeçalho: gradiente azul com clarões e onda que desce suave até a ponta (onde fica a setinha).
 * Só decoração; estica com a altura do conteúdo.
 */
function HeroBackground() {
  return (
    <svg aria-hidden="true" className="absolute inset-0 size-full md:rounded-t-[32px]" viewBox="0 0 390 360" preserveAspectRatio="none">
      <defs>
        <linearGradient id="module-hero-bg" x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor="#05379A" />
          <stop offset=".6" stopColor="#0A47AE" />
          <stop offset="1" stopColor="#1A5CC4" />
        </linearGradient>
        <radialGradient id="module-hero-glow" cx=".95" cy=".3" r=".5">
          <stop offset="0" stopColor="#7FB2FF" stopOpacity=".45" />
          <stop offset="1" stopColor="#7FB2FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="module-hero-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#ffffff" stopOpacity=".16" />
        </linearGradient>
        <filter id="module-hero-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      {/* Onda: laterais um pouco mais altas, desce em curva suave até a ponta central */}
      <path d="M0 0H390V318C346 312 300 322 252 336Q214 348 195 350Q176 348 138 336C90 322 44 312 0 318Z" fill="url(#module-hero-bg)" />
      <path d="M0 0H390V318C346 312 300 322 252 336Q214 348 195 350Q176 348 138 336C90 322 44 312 0 318Z" fill="url(#module-hero-glow)" />
      <path d="M0 250H390V318C346 312 300 322 252 336Q214 348 195 350Q176 348 138 336C90 322 44 312 0 318Z" fill="url(#module-hero-edge)" />
      <path
        d="M0 318C44 312 90 322 138 336Q176 348 195 350Q214 348 252 336C300 322 346 312 390 318"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".55"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="350" cy="110" r="70" fill="#8EC2FF" opacity=".22" filter="url(#module-hero-blur)" />
      <circle cx="40" cy="40" r="60" fill="#3E7FE0" opacity=".35" filter="url(#module-hero-blur)" />
      <circle cx="300" cy="150" r="2" fill="#fff" opacity=".9" />
      <circle cx="80" cy="190" r="1.6" fill="#fff" opacity=".8" />
      <circle cx="210" cy="96" r="1.4" fill="#fff" opacity=".7" />
      <circle cx="345" cy="58" r="1.5" fill="#fff" opacity=".8" />
    </svg>
  );
}

/**
 * Cabeçalho padrão dos módulos (Finanças, Saúde, Casa, Igreja): painel azul em gradiente que ocupa o topo da tela,
 * com logo e os botões redondos (tema, agenda, família) no celular, o título e o menu em ferradura.
 * Fecha em onda com a setinha na ponta, que abre o HeroDrawer da página, se houver (`drawerLabel` nomeia o conteúdo).
 */
export function ModuleHero({ title, drawerLabel, children }: { title: string; drawerLabel?: string; children?: ReactNode }) {
  return (
    <div className="relative -mx-4 -mt-[calc(env(safe-area-inset-top)+12px)] mb-10 text-white md:mx-0 md:mt-0">
      <HeroBackground />
      <div className="relative px-4 pb-12 pt-[calc(env(safe-area-inset-top)+14px)] md:px-8 md:pt-7">
        {/* No desktop, logo, tema, agenda e família ficam na barra lateral */}
        <div className="flex items-center justify-between pl-1 md:hidden">
          <Link href="/inicio" aria-label="Oliveira's, ir para o Início" className="rounded-2xl text-white">
            <Logo inverted size={30} />
          </Link>
          <div className="flex gap-2">
            <ThemeToggle className={headBtn} />
            <AgendaCalendarButton className={headBtn}>
              <CalendarDays size={20} strokeWidth={1.8} aria-hidden />
            </AgendaCalendarButton>
            <Link href="/familia" aria-label="Família" className={headBtn}>
              <Users size={20} strokeWidth={1.8} aria-hidden />
            </Link>
          </div>
        </div>
        <h1 className="text-on-image mt-3 text-center text-[30px] font-bold tracking-tight md:mt-0">{title}</h1>
        <div className="mt-1">{children}</div>
      </div>
      <HeroDrawerButton label={drawerLabel ?? `detalhes de ${title}`} />
    </div>
  );
}
