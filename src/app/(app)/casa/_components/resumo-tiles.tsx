import { FileText, ListChecks, PawPrint, Phone, Receipt, ShoppingCart, UtensilsCrossed, Wrench, type LucideIcon } from "lucide-react";
import { SummaryTile } from "@/components/module-home";
import { isPetAlert, petAlertRank } from "@/lib/summary-tile";
import type { CasaTile } from "@/lib/casa/resumo";

const ICON: Record<CasaTile["key"], LucideIcon> = {
  compras: ShoppingCart,
  pet: PawPrint,
  tarefas: ListChecks,
  manutencao: Wrench,
  contas: Receipt,
  documentos: FileText,
  cardapio: UtensilsCrossed,
  prestadores: Phone,
};

/** Cards do Resumo da Casa (mesma altura; o Pet com alertas em destaque). `only`: mostra só esses cards. */
export function CasaResumoTiles({ tiles, only }: { tiles: CasaTile[]; only?: CasaTile["key"][] }) {
  const list = only ? tiles.filter((t) => only.includes(t.key)) : tiles;
  return (
    <div className="grid auto-rows-fr gap-3 md:grid-cols-2">
      {list.map((t) => (
        <SummaryTile
          key={t.key}
          href={t.href}
          icon={ICON[t.key]}
          title={t.title}
          testId={t.testId}
          lines={t.lines}
          {...(t.key === "pet" ? { isAlert: isPetAlert, alertRank: petAlertRank } : {})}
        />
      ))}
    </div>
  );
}
