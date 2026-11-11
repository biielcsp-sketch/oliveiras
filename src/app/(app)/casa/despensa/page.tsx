import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { toSpDate } from "@/lib/agenda/dates";
import { num, PANTRY_COLS, type PantryItem } from "@/lib/casa/types";
import { PantryView, type PantryVM } from "../_components/pantry-view";

export const metadata = { title: "Despensa · Casa" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("casa_pantry_items").select(PANTRY_COLS).eq("household_id", ctx.household.id).order("name").limit(500);
  const items: PantryVM[] = ((data ?? []) as PantryItem[]).map((x) => ({
    ...x,
    quantity: num(x.quantity) ?? 0,
    min_quantity: num(x.min_quantity) ?? 0,
  }));
  return <PantryView items={items} today={toSpDate(new Date())} />;
}
