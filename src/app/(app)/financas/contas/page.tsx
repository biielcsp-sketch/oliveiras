import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { ACCOUNT_KIND_LABEL, getFinanceBase } from "@/lib/financas/data";
import { formatBRL } from "@/lib/financas/money";

export const metadata = { title: "Contas" };

export default async function ContasPage() {
  const [{ members }, { accounts }] = await Promise.all([getAppContext(), getFinanceBase()]);
  const memberName = new Map(members.map((m) => [m.id, m.name]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex">
        <LinkButton href="/financas/contas/nova" size="sm">
          <Plus size={15} aria-hidden /> Nova conta
        </LinkButton>
      </div>
      {accounts.length === 0 ? (
        <EmptyState title="Nenhuma conta ainda">Cadastre contas correntes, poupanças e cartões.</EmptyState>
      ) : (
        <Card className="py-1">
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link href={`/financas/contas/${a.id}`} className={`flex items-center gap-3 py-3 ${a.archived ? "opacity-50" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="truncate text-[13px] text-muted">
                      {ACCOUNT_KIND_LABEL[a.kind]}
                      {a.institution && ` · ${a.institution}`}
                      {` · ${a.owner_member_id ? memberName.get(a.owner_member_id) : "Conjunta"}`}
                      {a.archived && " · arquivada"}
                      {a.external_id && " · Open Finance"}
                    </p>
                    {a.bank_balance !== null && Math.round(a.bank_balance * 100) !== Math.round(a.balance * 100) && (
                      <p className="text-[12px] text-danger">Banco informa {formatBRL(a.bank_balance)}</p>
                    )}
                  </div>
                  <span className={`tabular-nums ${a.balance < 0 ? "text-danger" : ""}`}>{formatBRL(a.balance)}</span>
                  <ChevronRight size={16} className="text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
