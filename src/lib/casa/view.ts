/** Regras de exibição da Casa (funções puras, testadas em tests/unit/casa.test.ts). Datas "AAAA-MM-DD" de São Paulo. */
import { diffDays } from "@/lib/agenda/dates";

export const MAINTENANCE_SOON_DAYS = 15;
export const NO_CATEGORY = "Sem categoria";

/** Itens pendentes agrupados por categoria (ordem alfabética, "Sem categoria" por último) e os comprados à parte. */
export function groupShopping<T extends { category: string | null; done: boolean; name: string }>(items: T[]) {
  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const map = new Map<string, T[]>();
  for (const i of pending) {
    const key = i.category?.trim() || NO_CATEGORY;
    map.set(key, [...(map.get(key) ?? []), i]);
  }
  const groups = [...map.entries()]
    .sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, "pt-BR")))
    .map(([category, list]) => ({ category, items: [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }));
  return { groups, done };
}

/** Tarefas ativas em atrasadas, de hoje e próximas (cada grupo pela data). */
export function choreBuckets<T extends { active: boolean; next_due_on: string | null }>(chores: T[], today: string) {
  const list = chores.filter((c) => c.active && c.next_due_on);
  const byDate = (a: T, b: T) => a.next_due_on!.localeCompare(b.next_due_on!);
  return {
    overdue: list.filter((c) => c.next_due_on! < today).sort(byDate),
    today: list.filter((c) => c.next_due_on === today).sort(byDate),
    upcoming: list.filter((c) => c.next_due_on! > today).sort(byDate),
  };
}

export type MaintenanceStatus = "vencida" | "em-breve" | "em-dia" | "sem-data";

/** Vencida: antes de hoje. Em breve: hoje até 15 dias. */
export function maintenanceStatus(nextDueOn: string | null, today: string): MaintenanceStatus {
  if (!nextDueOn) return "sem-data";
  const days = diffDays(today, nextDueOn);
  if (days < 0) return "vencida";
  if (days <= MAINTENANCE_SOON_DAYS) return "em-breve";
  return "em-dia";
}

/** Ordem por próxima data (mais cedo primeiro); sem data por último. */
export function sortMaintenance<T extends { next_due_on: string | null; name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.next_due_on && b.next_due_on) return a.next_due_on.localeCompare(b.next_due_on) || a.name.localeCompare(b.name, "pt-BR");
    if (a.next_due_on) return -1;
    if (b.next_due_on) return 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

const qtyFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
export const formatQty = (n: number) => qtyFmt.format(n);
export const qtyLabel = (q: number | null, unit: string | null) => (q === null ? (unit ?? "") : `${formatQty(q)}${unit ? ` ${unit}` : ""}`).trim();

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "Diária", "Semanal: seg, qua", "Mensal: dia 31 (ou o último dia do mês)". */
export function frequencyLabel(c: { frequency: string; weekdays: number[] | null; month_day: number | null }) {
  if (c.frequency === "diaria") return "Diária";
  if (c.frequency === "semanal") {
    const days = [...(c.weekdays ?? [])].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]?.toLowerCase());
    return `Semanal: ${days.join(", ")}`;
  }
  return `Mensal: dia ${c.month_day}${(c.month_day ?? 0) > 28 ? " (ou o último dia do mês)" : ""}`;
}

export function intervalLabel(value: number, unit: string) {
  const singular: Record<string, string> = { dias: "dia", semanas: "semana", meses: "mês", anos: "ano" };
  return value === 1 ? `A cada ${singular[unit] ?? unit}` : `A cada ${value} ${unit}`;
}
