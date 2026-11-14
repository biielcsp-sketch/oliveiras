import Image from "next/image";
import type { ReactNode } from "react";

/** Card de vidro de destaque da raiz do módulo: texto à esquerda e ilustração à direita (decorativa). */
export function ModuleHeroCard({ title, subtitle, image }: { title: string; subtitle: string; image: string }) {
  return (
    <div className="glass-card relative flex h-[118px] flex-col justify-center overflow-hidden rounded-[20px] p-[18px]">
      <h2 className="relative z-10 max-w-[60%] text-[17px] font-semibold leading-snug tracking-tight">{title}</h2>
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

/** Título de bloco no estilo da prévia ("Despesas por categoria", "Ver detalhes ›"). */
export function BlockTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-[15.5px] font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
