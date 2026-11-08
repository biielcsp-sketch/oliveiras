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
        "rounded-full px-2.5 py-1 text-[12px] font-medium leading-none",
        status === "paga" && "bg-accent-soft text-primary",
        status === "atrasada" && "bg-badge text-on-badge",
        status === "vence_hoje" && "bg-warning-soft text-warning",
        status === "a_vencer" && "bg-surface-2 text-muted",
      )}
    >
      {LABEL[status]}
    </span>
  );
}
