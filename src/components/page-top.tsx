import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** Botão redondo transparente do topo (voltar, ⋮): 44px de área de toque. */
export const topBtn =
  "grid size-11 shrink-0 place-items-center rounded-full text-ink transition hover:bg-accent-soft hover:text-deep active:scale-95";

/**
 * Topo claro das telas internas: voltar à esquerda, título centralizado e uma ação opcional à direita.
 * O título é o h1 da tela.
 */
export function PageTop({
  title,
  backHref,
  backLabel = "Voltar",
  action,
}: {
  title: string;
  backHref: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <header className="relative z-20 mb-4 flex h-12 items-center justify-between gap-2">
      <Link href={backHref} aria-label={backLabel} className={topBtn}>
        <ArrowLeft size={22} strokeWidth={2} aria-hidden />
      </Link>
      <h1 className="min-w-0 truncate text-center text-[17px] font-semibold tracking-tight">{title}</h1>
      {action ?? <span className="size-11 shrink-0" aria-hidden />}
    </header>
  );
}
