import Link from "next/link";
import { Card, SeeAll } from "@/components/ui";
import { BlockTitle } from "@/components/module-home";
import type { BudgetHighlight } from "@/lib/financas/budget-highlights";
import { formatBRL } from "@/lib/financas/money";

function Bar({ ratio }: { ratio: number }) {
  return (
    <div className="mt-2 h-2 rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${ratio > 1 ? "bg-danger" : "bg-hero"}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
    </div>
  );
}

/** Orçamento do mês no Resumo: barra do total e as categorias mais pressionadas (vermelho quando passa do limite). */
export function BudgetSummary({
  month,
  spent,
  total,
  rows,
}: {
  month: string;
  spent: number;
  total: number;
  rows: BudgetHighlight[];
}) {
  const ratio = total > 0 ? spent / total : 0;
  return (
    <section>
      <BlockTitle action={<SeeAll href={`/financas/orcamento?mes=${month}`}>Ver tudo</SeeAll>}>Orçamento</BlockTitle>
      <Card className="p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="tabular-nums">
            {formatBRL(spent)} <span className="text-muted">de {formatBRL(total)}</span>
          </span>
          <span className="font-semibold tabular-nums">{Math.round(ratio * 100)}%</span>
        </div>
        <Bar ratio={ratio} />
        {rows.length > 0 && (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {rows.map((r) => (
              <li key={r.categoryId}>
                <Link
                  href={`/financas/lancamentos?mes=${month}&categoria=${r.categoryId}`}
                  className="block rounded-xl py-3 text-[14px] transition hover:text-primary"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <span className={`shrink-0 text-[12.5px] tabular-nums ${r.ratio > 1 ? "font-semibold text-danger" : "text-muted"}`}>
                      {formatBRL(r.spent)} de {formatBRL(r.amount)}
                    </span>
                  </span>
                  <Bar ratio={r.ratio} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
