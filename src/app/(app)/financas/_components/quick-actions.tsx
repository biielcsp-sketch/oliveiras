import Link from "next/link";
import { ArrowLeftRight, CalendarClock, Plus, Upload } from "lucide-react";

/** Atalhos redondos do Resumo das Finanças. Só levam a telas que já existem. */
export function QuickActions({ month }: { month: string }) {
  const actions = [
    { href: "/financas/lancamentos/novo", label: "Lançar", icon: Plus },
    { href: "/financas/importar", label: "Importar", icon: Upload },
    { href: `/financas/contas-fixas?mes=${month}`, label: "Contas fixas", icon: CalendarClock },
    { href: `/financas/lancamentos?mes=${month}&tipo=transferencias`, label: "Transferências", icon: ArrowLeftRight },
  ];
  return (
    <nav aria-label="Atalhos de Finanças" className="grid grid-cols-4 gap-2">
      {actions.map(({ href, label, icon: Icon }) => (
        <Link key={label} href={href} className="group flex min-w-0 flex-col items-center gap-1.5 py-1 text-center">
          <span className="glass-card grid size-12 place-items-center rounded-full text-primary transition group-active:scale-95">
            <Icon size={20} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="w-full text-[11.5px] font-medium leading-tight text-muted">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
