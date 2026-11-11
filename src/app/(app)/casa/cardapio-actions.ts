"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { addDays, isDate } from "@/lib/agenda/dates";
import { formToObject, isUuid, validateMealInput, validateShoppingInput } from "@/lib/casa/input";
import { ingredientsToAdd, mondayOf, planWeekCopy } from "@/lib/casa/menu";
import { MEAL_COLS, type MealPlan } from "@/lib/casa/types";

export type MealState = { ok?: boolean; error?: string; message?: string } | null;
type Result = { ok: boolean; erro?: string; message?: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const GENERIC = "Não foi possível salvar. Tente de novo.";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function refresh() {
  revalidatePath("/casa", "layout");
}

/** 23514 = trigger dos ingredientes (0017): vazio, nulo ou acima de 80 caracteres. */
const mealDbError = (code?: string) => (code === "23514" ? "Ingredientes inválidos. Revise e salve de novo." : GENERIC);

/**
 * Salva a refeição do dia. upsert em (household_id, day, meal): se o outro celular criou a mesma refeição
 * ao mesmo tempo, não dá erro de duplicidade; vale a última gravação.
 */
export async function saveMeal(_: MealState, form: FormData): Promise<MealState> {
  const ctx = await getAppContext();
  const parsed = validateMealInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  const db = await createClient();
  const { error } = await db
    .from("casa_meal_plan")
    .upsert({ ...parsed.value, household_id: ctx.household.id }, { onConflict: "household_id,day,meal" });
  if (error) return { error: mealDbError(error.code) };
  refresh();
  return { ok: true, message: "Refeição salva." };
}

export async function deleteMeal(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: "Refeição inválida." };
  const db = await createClient();
  const { data, error } = await db.from("casa_meal_plan").delete().eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: "Refeição não encontrada." };
  refresh();
  return { ok: true };
}

async function weekMeals(db: Db, householdId: string, monday: string) {
  const { data } = await db
    .from("casa_meal_plan")
    .select(MEAL_COLS)
    .eq("household_id", householdId)
    .gte("day", monday)
    .lte("day", addDays(monday, 6))
    .limit(100);
  return (data ?? []) as MealPlan[];
}

/** Copia a semana anterior para a semana mostrada, sem sobrescrever o que já está planejado (nem o que o outro celular gravar no meio). */
export async function copyPreviousWeek(week: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isDate(week)) return { ok: false, erro: "Semana inválida." };
  const monday = mondayOf(week);
  const db = await createClient();
  const [previous, current] = await Promise.all([weekMeals(db, ctx.household.id, addDays(monday, -7)), weekMeals(db, ctx.household.id, monday)]);
  if (previous.length === 0) return { ok: false, erro: "A semana anterior está vazia." };
  const rows = planWeekCopy(previous, current, monday);
  if (rows.length === 0) return { ok: true, message: "Nada para copiar: esta semana já tem essas refeições." };
  const { data, error } = await db
    .from("casa_meal_plan")
    .upsert(
      rows.map((r) => ({ ...r, household_id: ctx.household.id })),
      { onConflict: "household_id,day,meal", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { ok: false, erro: mealDbError(error.code) };
  refresh();
  return { ok: true, message: `${plural(data?.length ?? 0, "refeição copiada", "refeições copiadas")} da semana anterior.` };
}

/**
 * Manda os ingredientes (de uma refeição ou da semana) para a lista de compras. Os ingredientes são lidos do
 * banco (nunca do navegador) e não duplicam itens PENDENTES com o mesmo nome (sem acento/maiúscula).
 */
export async function sendIngredientsToList(target: { mealId?: string; week?: string }): Promise<Result> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  const db = await createClient();
  let meals: MealPlan[];
  if (target?.mealId !== undefined) {
    if (!isUuid(target.mealId)) return { ok: false, erro: "Refeição inválida." };
    const { data } = await db.from("casa_meal_plan").select(MEAL_COLS).eq("household_id", hh).eq("id", target.mealId).maybeSingle();
    if (!data) return { ok: false, erro: "Refeição não encontrada." };
    meals = [data as MealPlan];
  } else if (typeof target?.week === "string" && isDate(target.week)) {
    meals = await weekMeals(db, hh, mondayOf(target.week));
  } else {
    return { ok: false, erro: "Pedido inválido." };
  }
  const ingredients = meals.flatMap((m) => m.ingredients ?? []);
  if (ingredients.length === 0) return { ok: false, erro: "Nenhum ingrediente cadastrado." };

  const { data: pending, error: readErr } = await db.from("casa_shopping_items").select("name").eq("household_id", hh).eq("done", false).limit(1000);
  if (readErr) return { ok: false, erro: "Não foi possível ler a lista de compras." };
  const { add, skipped } = ingredientsToAdd(ingredients, (pending ?? []).map((p) => p.name as string));
  // Mesma validação dos itens digitados na lista de compras.
  const rows = add.map((name) => validateShoppingInput({ name })).flatMap((r) => (r.ok ? [{ ...r.value, household_id: hh }] : []));
  if (rows.length > 0) {
    const { error } = await db.from("casa_shopping_items").insert(rows);
    if (error) return { ok: false, erro: "Não foi possível adicionar à lista." };
  }
  refresh();
  const added = rows.length ? `${plural(rows.length, "item adicionado", "itens adicionados")} à lista de compras` : "Nenhum item novo na lista de compras";
  return { ok: true, message: skipped ? `${added}; ${plural(skipped, "já estava", "já estavam")} na lista.` : `${added}.` };
}
