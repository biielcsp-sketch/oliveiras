import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "@/lib/financas/period";

/** Troca de mês preservando os demais filtros da URL. Ocupa a linha toda, com o mês no centro. */
export function MonthSwitcher({ month, basePath, params = {} }: { month: string; basePath: string; params?: Record<string, string | undefined> }) {
  const href = (m: string) => {
    const q = new URLSearchParams();
    Object.entries({ ...params, mes: m }).forEach(([k, v]) => v && q.set(k, v));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <Link href={href(shiftMonth(month, -1))} aria-label="Mês anterior" className="glass glass-shine grid size-11 shrink-0 place-items-center rounded-full border border-[var(--glass-edge)] text-ink shadow-glass transition hover:text-primary">
        <ChevronLeft size={18} />
      </Link>
      <span className="flex-1 text-center text-base font-semibold">{monthLabel(month)}</span>
      <Link href={href(shiftMonth(month, 1))} aria-label="Próximo mês" className="glass glass-shine grid size-11 shrink-0 place-items-center rounded-full border border-[var(--glass-edge)] text-ink shadow-glass transition hover:text-primary">
        <ChevronRight size={18} />
      </Link>
    </div>
  );
}
