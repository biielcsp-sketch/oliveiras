import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { addDays, toSpDate } from "@/lib/agenda/dates";
import { parseWeek } from "@/lib/casa/menu";
import { MEAL_COLS, type MealPlan } from "@/lib/casa/types";
import { MenuView } from "../_components/menu-view";

export const metadata = { title: "Cardápio · Casa" };

export default async function Page({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const today = toSpDate(new Date());
  const monday = parseWeek((await searchParams).semana, today);
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db
    .from("casa_meal_plan")
    .select(MEAL_COLS)
    .eq("household_id", ctx.household.id)
    .gte("day", monday)
    .lte("day", addDays(monday, 6))
    .limit(100);
  const meals = ((data ?? []) as MealPlan[]).map((m) => ({ ...m, ingredients: m.ingredients ?? [] }));
  return <MenuView monday={monday} today={today} meals={meals} />;
}
