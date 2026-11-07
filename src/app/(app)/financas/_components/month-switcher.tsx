import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "@/lib/financas/period";

/** Troca de mês preservando os demais filtros da URL. */
export function MonthSwitcher({ month, basePath, params = {} }: { month: string; basePath: string; params?: Record<string, string | undefined> }) {
  const href = (m: string) => {
    const q = new URLSearchParams();
    Object.entries({ ...params, mes: m }).forEach(([k, v]) => v && q.set(k, v));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="flex items-center gap-1">
      <Link href={href(shiftMonth(month, -1))} aria-label="Mês anterior" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2">
        <ChevronLeft size={18} />
      </Link>
      <span className="min-w-36 text-center text-sm font-medium">{monthLabel(month)}</span>
      <Link href={href(shiftMonth(month, 1))} aria-label="Próximo mês" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2">
        <ChevronRight size={18} />
      </Link>
    </div>
  );
}
