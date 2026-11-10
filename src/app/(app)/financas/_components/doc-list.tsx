import Link from "next/link";
import clsx from "clsx";
import { FileText, Image as ImageIcon } from "lucide-react";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/financas/documentos/rules";
import type { DocListItem } from "@/lib/financas/documentos/data";

/** Lista de documentos. Texto lido do arquivo entra só como texto do React (escapado). */
export function DocList({ docs }: { docs: DocListItem[] }) {
  return (
    <ul className="divide-y divide-line" data-testid="lista-documentos">
      {docs.map((d) => {
        const when = d.kind === "comprovante" ? d.paid_on : d.due_date;
        return (
          <li key={d.id} className="flex items-center gap-3 py-3">
            {d.file_mime === "application/pdf" ? (
              <FileText size={18} className="shrink-0 text-muted" aria-hidden />
            ) : (
              <ImageIcon size={18} className="shrink-0 text-muted" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <Link href={`/financas/documentos/${d.id}`} className="block truncate font-medium hover:underline">
                {d.payee ?? `${KIND_LABEL[d.kind]} sem beneficiário`}
              </Link>
              <p className="text-[12px] text-muted">
                {KIND_LABEL[d.kind]}
                {when && ` · ${d.kind === "comprovante" ? "pago" : "vence"} ${shortDate(when)}`}
                {` · enviado ${shortDate(d.created_at.slice(0, 10))}`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {d.amount !== null && <span className="tabular-nums">{formatBRL(d.amount)}</span>}
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  d.status === "pendente" ? "bg-warning-soft text-warning" : d.status === "confirmado" ? "bg-accent-soft text-ink" : "bg-surface-2 text-muted",
                )}
              >
                {STATUS_LABEL[d.status]}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
