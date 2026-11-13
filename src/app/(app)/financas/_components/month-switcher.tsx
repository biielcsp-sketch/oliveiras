import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "@/lib/financas/period";

const circle = "glass-card grid size-11 shrink-0 place-items-center rounded-full text-deep transition hover:text-primary active:scale-95";

/** Troca de mês preservando os demais filtros da URL: botões de vidro e o mês numa pílula de vidro no centro. */
export function MonthSwitcher({ month, basePath, params = {} }: { month: string; basePath: string; params?: Record<string, string | undefined> }) {
  const href = (m: string) => {
    const q = new URLSearchParams();
    Object.entries({ ...params, mes: m }).forEach(([k, v]) => v && q.set(k, v));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="flex w-full items-center gap-2.5">
      <Link href={href(shiftMonth(month, -1))} aria-label="Mês anterior" className={circle}>
        <ChevronLeft size={18} strokeWidth={2.2} aria-hidden />
      </Link>
      <span className="glass-card grid h-11 flex-1 place-items-center rounded-full text-[15px] font-bold">{monthLabel(month)}</span>
      <Link href={href(shiftMonth(month, 1))} aria-label="Próximo mês" className={circle}>
        <ChevronRight size={18} strokeWidth={2.2} aria-hidden />
      </Link>
    </div>
  );
}
