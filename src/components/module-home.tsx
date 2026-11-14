import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { tileRows } from "@/lib/summary-tile";
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

/**
 * Card de resumo/atalho (Casa > Resumo, Igreja > Resumo): todos com a mesma altura, conteúdo centralizado na vertical.
 * Subtítulo pelo tileRows: alertas (`isAlert`, em ordem de `alertRank`) primeiro, em destaque, em até 2 linhas;
 * o resto numa linha cortada. Título (20px) + alertas (2×18px) + resto (18px) cabem nos 88px.
 */
export function SummaryTile({
  href,
  icon: Icon,
  title,
  lines,
  testId,
  isAlert,
  alertRank,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  lines: string[];
  testId: string;
  isAlert?: (line: string) => boolean;
  alertRank?: (line: string) => number;
}) {
  const rows = tileRows(lines, isAlert, alertRank);
  const hasAlert = !!isAlert && lines.some(isAlert);
  // min-w-0: sem ele o item da grade cresce até a largura do texto e a página rola para os lados
  return (
    <Link href={href} className="block min-w-0" data-testid={testId}>
      <div className="glass-card flex h-[88px] items-center gap-3.5 rounded-[20px] px-4 transition hover:brightness-105" data-summary-tile>
        <span className="tic size-[42px] shrink-0">
          <Icon size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-5 tracking-tight">{title}</p>
          {rows.map((r, i) => (
            <p
              key={i}
              className={`text-[13px] leading-[18px] ${hasAlert && i === 0 ? "line-clamp-2 font-medium text-danger" : "truncate text-muted"}`}
              data-alert={hasAlert && i === 0 ? "true" : undefined}
            >
              {r}
            </p>
          ))}
        </div>
      </div>
    </Link>
  );
}
