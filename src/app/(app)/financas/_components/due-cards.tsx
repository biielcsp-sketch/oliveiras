import Link from "next/link";
import clsx from "clsx";
import { btnBase, btnSize, btnVariant } from "@/components/ui";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";
import { billStatus } from "@/lib/financas/planning";
import { StatusBadge } from "./status-badge";

export type Due = { key: string; name: string; due: string; amount: number; kind: "conta" | "fatura" };

/**
 * Vencimentos do mês em cards lado a lado (rolam para o lado). Conta fixa: "Pagar" abre o pagamento dela.
 * Fatura de cartão ainda não tem tela de pagamento própria: "Ver fatura" abre as faturas em Contas fixas.
 */
export function DueCards({ dues, month, today }: { dues: Due[]; month: string; today: string }) {
  return (
    <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {dues.map((d) => (
        <li key={d.key} className="glass-card w-[168px] shrink-0 snap-start rounded-[18px] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] tabular-nums text-muted">{shortDate(d.due)}</span>
            <StatusBadge status={billStatus(d.due, false, today)} />
          </div>
          <p className="mt-2 truncate text-[14.5px] font-semibold">{d.name}</p>
          <p className="mt-0.5 text-[16px] font-bold tabular-nums text-danger">{formatBRL(d.amount)}</p>
          <Link
            href={d.kind === "conta" ? `/financas/contas-fixas/${d.key}/pagar?mes=${month}` : `/financas/contas-fixas?mes=${month}`}
            aria-label={`${d.kind === "conta" ? "Pagar" : "Ver fatura de"} ${d.name}`}
            className={clsx(btnBase, btnSize.sm, d.kind === "conta" ? btnVariant.primary : btnVariant.ghost, "relative mt-3 w-full")}
          >
            {d.kind === "conta" ? "Pagar" : "Ver fatura"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
