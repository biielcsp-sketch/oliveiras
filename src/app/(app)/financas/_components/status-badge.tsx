import clsx from "clsx";
import type { BillStatus } from "@/lib/financas/planning";

const LABEL: Record<BillStatus, string> = {
  paga: "Paga",
  atrasada: "Atrasada",
  vence_hoje: "Vence hoje",
  a_vencer: "A vencer",
};

export function StatusBadge({ status }: { status: BillStatus }) {
  return (
    <span
      className={clsx(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "paga" && "bg-olive-soft text-olive",
        status === "atrasada" && "bg-danger/15 text-danger",
        status === "vence_hoje" && "bg-danger/10 text-danger",
        status === "a_vencer" && "bg-surface-2 text-muted",
      )}
    >
      {LABEL[status]}
    </span>
  );
}
