import { BookHeart, GraduationCap, HandHeart, Target, Users, type LucideIcon } from "lucide-react";
import { SummaryTile } from "@/components/module-home";
import type { IgrejaTile } from "@/lib/igreja/resumo";

const ICON: Record<IgrejaTile["key"], LucideIcon> = {
  oracoes: HandHeart,
  propositos: Target,
  anotacao: BookHeart,
  carisma: GraduationCap,
  consolidacao: Users,
};

/** Cards do Resumo da Igreja (mesma altura). */
export function IgrejaResumoTiles({ tiles }: { tiles: IgrejaTile[] }) {
  return (
    <div className="grid auto-rows-fr gap-3 md:grid-cols-2">
      {tiles.map((t) => (
        <SummaryTile key={t.key} href={t.href} icon={ICON[t.key]} title={t.title} testId={t.testId} lines={t.lines} />
      ))}
    </div>
  );
}
