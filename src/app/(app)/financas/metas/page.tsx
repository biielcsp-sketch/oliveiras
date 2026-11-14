import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { getFinanceBase } from "@/lib/financas/data";
import { getGoals } from "@/lib/financas/planning-data";
import { goalProgress } from "@/lib/financas/planning";
import { formatBRL } from "@/lib/financas/money";
import { todaySP } from "@/lib/financas/today";

export const metadata = { title: "Metas" };

export default async function MetasPage() {
  const [{ accounts }, goals] = await Promise.all([getFinanceBase(), getGoals()]);
  const account = new Map(accounts.map((a) => [a.id, a]));
  const today = todaySP();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex">
        <LinkButton href="/financas/metas/nova" size="sm">
          <Plus size={15} aria-hidden /> Nova meta
        </LinkButton>
      </div>
      {goals.length === 0 ? (
        <EmptyState title="Nenhuma meta ainda">Reserva de emergência, viagem, troca do carro…</EmptyState>
      ) : (
        goals.map((g) => {
          const acc = g.account_id ? account.get(g.account_id) : undefined;
          const p = goalProgress(acc?.balance ?? 0, g.target, g.target_date, today);
          return (
            <Link key={g.id} href={`/financas/metas/${g.id}`}>
              <Card className="transition hover:bg-surface-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{g.name}</p>
                  <p className="text-sm tabular-nums text-muted">{Math.round(p.pct * 100)}%</p>
                </div>
                <div className="mt-2 h-2 rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-olive" style={{ width: `${p.pct * 100}%` }} />
                </div>
                <p className="mt-2 text-sm tabular-nums">
                  {formatBRL(p.saved)} <span className="text-muted">de {formatBRL(g.target)}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {acc ? acc.name : "Sem conta vinculada"}
                  {p.remaining === 0
                    ? " · meta atingida"
                    : p.perMonth !== null
                      ? ` · guardar ${formatBRL(p.perMonth)}/mês${p.monthsLeft === 0 ? " (prazo neste mês)" : ` por ${p.monthsLeft} meses`}`
                      : ` · faltam ${formatBRL(p.remaining)}`}
                </p>
              </Card>
            </Link>
          );
        })
      )}
    </div>
  );
}
