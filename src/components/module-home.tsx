import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { MODULE_INFO, type ModuleKey } from "@/lib/module-sections";

/** Card de vidro de destaque da raiz do módulo: texto à esquerda e ilustração à direita (decorativa). */
export function ModuleHeroCard({ title, subtitle, image }: { title: string; subtitle: string; image: string }) {
  return (
    <div className="glass-card relative flex h-[118px] flex-col justify-center overflow-hidden rounded-[20px] p-[18px]">
      <h2 className="relative z-10 max-w-[60%] text-[17px] font-bold leading-snug tracking-tight">{title}</h2>
      <p className="relative z-10 mt-1.5 max-w-[60%] text-[12.5px] text-muted">{subtitle}</p>
      <Image
        src={image}
        alt=""
        width={230}
        height={230}
        unoptimized
        className="pointer-events-none absolute right-1.5 top-1 h-[110px] w-auto [mask-image:linear-gradient(90deg,transparent_0,#000_22%)]"
      />
    </div>
  );
}

/**
 * Grade de botões de vidro (2 colunas) com todas as seções do módulo.
 * `hrefOverride` troca o destino de uma seção (ex.: Carteirinhas, que fica na própria raiz da Saúde).
 */
export function SectionGrid({ module: key, hrefOverride = {} }: { module: ModuleKey; hrefOverride?: Record<string, string> }) {
  const info = MODULE_INFO[key];
  return (
    <nav aria-label={`Seções de ${info.title}`}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {info.sections.map((s) => {
          const Icon = s.icon;
          return (
            <li key={s.key}>
              <Link
                href={hrefOverride[s.key] ?? s.href}
                className="glass-card flex h-[100px] flex-col items-center justify-center gap-2 rounded-[20px] px-1 text-center text-[13.5px] font-medium text-ink transition hover:brightness-105 active:scale-[0.98]"
              >
                <span className="tic size-[46px]">
                  <Icon size={22} strokeWidth={1.8} aria-hidden />
                </span>
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Título de bloco no estilo da prévia ("Despesas por categoria", "Ver detalhes ›"). */
export function BlockTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-[15.5px] font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
