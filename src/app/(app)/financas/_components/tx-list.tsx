import Link from "next/link";
import clsx from "clsx";
import type { Account, Category, Transaction } from "@/lib/financas/types";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";

export function TxList({
  transactions,
  accounts,
  categories,
}: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
}) {
  const account = new Map(accounts.map((a) => [a.id, a]));
  const category = new Map(categories.map((c) => [c.id, c]));
  return (
    <ul className="divide-y divide-line">
      {transactions.map((t) => {
        const cat = t.category_id ? category.get(t.category_id) : undefined;
        const transfer = cat?.kind === "transferencia";
        return (
          <li key={t.id}>
            <Link href={`/financas/lancamentos/${t.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-2/50">
              <span className="w-11 shrink-0 text-[13px] tabular-nums text-muted">{shortDate(t.date)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{t.description}</p>
                <p className="flex items-center gap-1.5 truncate text-[12px] text-muted">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: cat?.color ?? "var(--line)" }}
                  />
                  {cat?.name ?? "Sem categoria"} · {account.get(t.account_id)?.name ?? "—"}
                </p>
              </div>
              <span
                className={clsx(
                  "shrink-0 text-[15px] font-medium tabular-nums",
                  transfer ? "text-muted" : t.amount > 0 ? "text-olive" : "text-ink",
                )}
              >
                {formatBRL(t.amount)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
