import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { num, SHOPPING_COLS, type ShoppingItem } from "@/lib/casa/types";
import { ShoppingView, type ShoppingVM } from "../_components/shopping-view";

export const metadata = { title: "Compras · Casa" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("casa_shopping_items").select(SHOPPING_COLS).eq("household_id", ctx.household.id).order("created_at").limit(500);
  const rows = (data ?? []) as ShoppingItem[];
  const items: ShoppingVM[] = rows.map((x) => ({
    id: x.id,
    name: x.name,
    quantity: num(x.quantity),
    unit: x.unit,
    category: x.category,
    notes: x.notes,
    done: x.done,
    fromPantry: !!x.pantry_item_id,
  }));
  const categories = [...new Set(rows.map((x) => x.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return <ShoppingView items={items} categories={categories} />;
}
