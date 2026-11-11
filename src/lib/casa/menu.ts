/** Cardápio da semana (funções puras). Semana de segunda a domingo; datas "AAAA-MM-DD". */
import { addDays, isDate } from "@/lib/agenda/dates";
import { nameKey } from "./input";
import { MEALS, type Meal } from "./types";

/** Segunda-feira da semana do dia. */
export function mondayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(date, -((dow + 6) % 7));
}

/** Semana pedida na URL (?semana=AAAA-MM-DD, qualquer dia dela) ou a semana de hoje. */
export function parseWeek(v: unknown, today: string) {
  return mondayOf(typeof v === "string" && isDate(v) ? v : today);
}

export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

type MealRow = { day: string; meal: Meal; title: string; ingredients: string[]; notes: string | null };

/**
 * Copiar a semana anterior: cada refeição de (segunda − 7 … domingo − 7) vai para o mesmo dia da semana atual.
 * Refeições que já existem na semana atual não são sobrescritas.
 */
export function planWeekCopy(previous: MealRow[], current: { day: string; meal: Meal }[], monday: string): MealRow[] {
  const from = addDays(monday, -7);
  const to = addDays(monday, -1);
  const taken = new Set(current.map((c) => `${c.day}|${c.meal}`));
  return previous
    .filter((r) => r.day >= from && r.day <= to && MEALS.includes(r.meal))
    .map((r) => ({ day: addDays(r.day, 7), meal: r.meal, title: r.title, ingredients: [...r.ingredients], notes: r.notes }))
    .filter((r) => !taken.has(`${r.day}|${r.meal}`));
}

/**
 * Ingredientes que vão para a lista de compras: sem repetir (sem acento/maiúscula) entre si
 * nem com itens PENDENTES da lista. Itens já comprados não contam (podem ir de novo).
 */
export function ingredientsToAdd(ingredients: string[], pendingNames: string[]) {
  const seen = new Set(pendingNames.map(nameKey));
  const add: string[] = [];
  let skipped = 0;
  for (const raw of ingredients) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const k = nameKey(name);
    if (seen.has(k)) {
      skipped++;
      continue;
    }
    seen.add(k);
    add.push(name);
  }
  return { add, skipped };
}
