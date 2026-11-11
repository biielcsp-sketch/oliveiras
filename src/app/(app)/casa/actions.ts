"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { isDate, toSpDate } from "@/lib/agenda/dates";
import {
  formToObject,
  isUuid,
  LIMITS,
  parseQuantity,
  validateChoreInput,
  validateMaintenanceDone,
  validateMaintenanceInput,
  validatePantryInput,
  validateRestockQuantity,
  validateShoppingInput,
  choreDbError,
} from "@/lib/casa/input";
import { firstDueOn, nextMaintenanceDue } from "@/lib/casa/schedule";
import { changeQuantityWith, completeChoreWith, restockOnce, skipChoreWith, toggleOnce, type ChoreRepo, type Expected, type ToggleRow } from "@/lib/casa/sync";
import { autoAddOutcome, shouldAutoAdd, toggleErrorMessage } from "@/lib/casa/view";
import { CHORE_COLS, MAINTENANCE_COLS, num, type Chore, type Maintenance } from "@/lib/casa/types";

export type CasaState = { ok?: boolean; error?: string; message?: string } | null;
type Result = { ok: boolean; erro?: string };
export type ToggleResult = Result & { restock?: { shoppingItemId: string; name: string; quantity: number; unit: string | null } };

const GENERIC = "Não foi possível salvar. Tente de novo.";
type Db = Awaited<ReturnType<typeof createClient>>;

const today = () => toSpDate(new Date());

function refresh() {
  revalidatePath("/casa", "layout");
}

/* ---------- Lista de compras ---------- */

export async function saveShoppingItem(_: CasaState, form: FormData): Promise<CasaState> {
  const ctx = await getAppContext();
  const parsed = validateShoppingInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Item inválido." };
  const db = await createClient();
  if (id) {
    const { data, error } = await db.from("casa_shopping_items").update(parsed.value).eq("household_id", ctx.household.id).eq("id", id).select("id");
    if (error) return { error: GENERIC };
    if (!data || data.length === 0) return { error: "Item não encontrado." };
  } else {
    const { error } = await db.from("casa_shopping_items").insert({ ...parsed.value, household_id: ctx.household.id });
    if (error) return { error: GENERIC };
  }
  refresh();
  return { ok: true, message: id ? "Item atualizado." : `${parsed.value.name} adicionado à lista.` };
}

/**
 * Marca/desmarca comprado. Só muda se ainda estiver no estado oposto: se o outro celular já marcou,
 * não devolve a sugestão de repor de novo. Item ligado à despensa, marcado agora, devolve a sugestão.
 */
export async function toggleShoppingItem(id: string, done: boolean): Promise<ToggleResult> {
  const ctx = await getAppContext();
  if (!isUuid(id) || typeof done !== "boolean") return { ok: false, erro: "Pedido inválido." };
  const db = await createClient();
  const hh = ctx.household.id;
  const r = await toggleOnce(
    {
      async updateIf(target) {
        const { data, error } = await db
          .from("casa_shopping_items")
          .update({ done: target, done_at: target ? new Date().toISOString() : null })
          .eq("household_id", hh)
          .eq("id", id)
          .eq("done", !target)
          .select("name, quantity, unit, pantry_item_id");
        if (error) return { code: error.code };
        return data && data.length > 0 ? (data[0] as ToggleRow) : null;
      },
      async exists() {
        const { data } = await db.from("casa_shopping_items").select("id").eq("household_id", hh).eq("id", id).maybeSingle();
        return !!data;
      },
    },
    done,
    toggleErrorMessage,
  );
  if (!r.ok) return r;
  refresh();
  if (!r.changed || !done || !r.row?.pantry_item_id) return { ok: true };
  const { data: p } = await db.from("casa_pantry_items").select("id, name, unit").eq("household_id", hh).eq("id", r.row.pantry_item_id).maybeSingle();
  if (!p) return { ok: true };
  return { ok: true, restock: { shoppingItemId: id, name: p.name, quantity: num(r.row.quantity) ?? 1, unit: p.unit } };
}

export async function clearDoneShopping(): Promise<Result> {
  const ctx = await getAppContext();
  const db = await createClient();
  const { error } = await db.from("casa_shopping_items").delete().eq("household_id", ctx.household.id).eq("done", true);
  if (error) return { ok: false, erro: "Não foi possível limpar." };
  refresh();
  return { ok: true };
}

export async function deleteShoppingItem(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: "Item inválido." };
  const db = await createClient();
  const { data, error } = await db.from("casa_shopping_items").delete().eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: "Item não encontrado." };
  refresh();
  return { ok: true };
}

/* ---------- Despensa ---------- */

type PantryRow = { id: string; name: string; quantity: number; min_quantity: number; unit: string | null; category: string | null };

/** Põe o item da despensa na lista de compras, se a regra mandar e ainda não houver um pendente ligado a ele. */
async function maybeAutoAdd(db: Db, householdId: string, p: PantryRow, before: number | null): Promise<boolean> {
  const after = Number(p.quantity);
  const min = Number(p.min_quantity);
  if (after > min) return false;
  const { data: pending } = await db
    .from("casa_shopping_items")
    .select("id")
    .eq("household_id", householdId)
    .eq("pantry_item_id", p.id)
    .eq("done", false)
    .limit(1);
  if (!shouldAutoAdd({ before, after, min, hasPending: !!pending && pending.length > 0 })) return false;
  const { error } = await db.from("casa_shopping_items").insert({
    household_id: householdId,
    name: p.name,
    unit: p.unit,
    category: p.category,
    pantry_item_id: p.id,
  });
  // "already" (23505) é sucesso silencioso: outro aparelho já pôs o item na lista. Nada de erro na tela.
  return autoAddOutcome(error?.code) === "added";
}

const PANTRY_ROW = "id, name, quantity, min_quantity, unit, category";

/** +/− e repor: controle otimista em changeQuantityWith (src/lib/casa/sync.ts). */
function changeQuantity(db: Db, householdId: string, id: string, delta: number) {
  return changeQuantityWith<PantryRow>(
    {
      async read() {
        const { data } = await db.from("casa_pantry_items").select(PANTRY_ROW).eq("household_id", householdId).eq("id", id).maybeSingle();
        return (data as PantryRow | null) ?? null;
      },
      async writeIf(expected, next) {
        const { data, error } = await db
          .from("casa_pantry_items")
          .update({ quantity: next })
          .eq("household_id", householdId)
          .eq("id", id)
          .eq("quantity", expected)
          .select(PANTRY_ROW);
        if (error) return "error";
        return data && data.length > 0 ? (data[0] as PantryRow) : null;
      },
    },
    delta,
    LIMITS.quantityMax,
  );
}

const PANTRY_CHANGED = "A quantidade mudou em outro aparelho. Feche e abra o item de novo para ver o valor atual.";

export async function savePantryItem(_: CasaState, form: FormData): Promise<CasaState> {
  const ctx = await getAppContext();
  const parsed = validatePantryInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Item inválido." };
  const db = await createClient();
  let row: PantryRow;
  let before: number | null = null;
  if (id) {
    // Quantidade lida quando o formulário abriu: só grava se ninguém mudou no meio (ex.: +/− no outro celular).
    const expected = parseQuantity(form.get("expected_quantity"));
    if (expected === null || expected === "x") return { error: "Item inválido." };
    const { data, error } = await db
      .from("casa_pantry_items")
      .update(parsed.value)
      .eq("household_id", ctx.household.id)
      .eq("id", id)
      .eq("quantity", expected)
      .select(PANTRY_ROW);
    if (error) return { error: GENERIC };
    if (!data || data.length === 0) {
      const { data: still } = await db.from("casa_pantry_items").select("id").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
      refresh(); // a tela atrás do formulário passa a mostrar o valor atual
      return { error: still ? PANTRY_CHANGED : "Item não encontrado." };
    }
    before = expected;
    row = data[0] as PantryRow;
  } else {
    const { data, error } = await db.from("casa_pantry_items").insert({ ...parsed.value, household_id: ctx.household.id }).select(PANTRY_ROW).single();
    if (error || !data) return { error: GENERIC };
    row = data as PantryRow;
  }
  const added = await maybeAutoAdd(db, ctx.household.id, row, before);
  refresh();
  const msg = id ? "Item atualizado." : "Item salvo na despensa.";
  return { ok: true, message: added ? `${msg} Está acabando: foi para a lista de compras.` : msg };
}

/** Botões +/− da despensa (passo 1, nunca abaixo de zero). */
export async function adjustPantry(id: string, delta: number): Promise<Result & { added?: boolean }> {
  const ctx = await getAppContext();
  if (!isUuid(id) || (delta !== 1 && delta !== -1)) return { ok: false, erro: "Pedido inválido." };
  const db = await createClient();
  const r = await changeQuantity(db, ctx.household.id, id, delta);
  if (!r.ok) return r;
  const added = await maybeAutoAdd(db, ctx.household.id, r.row, r.before);
  refresh();
  return { ok: true, added };
}

/**
 * "Repor na despensa" a partir do item comprado da lista: soma uma vez só por item.
 * Desliga o vínculo (pantry_item_id = null) com update condicional; só soma quem desligou (restockOnce).
 */
export async function restockPantry(shoppingItemId: string, quantity: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(shoppingItemId)) return { ok: false, erro: "Item inválido." };
  const q = validateRestockQuantity(quantity);
  if (!q.ok) return q;
  const db = await createClient();
  const hh = ctx.household.id;
  const r = await restockOnce(
    {
      async readItem() {
        const { data } = await db.from("casa_shopping_items").select("done, pantry_item_id").eq("household_id", hh).eq("id", shoppingItemId).maybeSingle();
        return data ?? null;
      },
      async unlinkIf(pantryId) {
        const { data, error } = await db
          .from("casa_shopping_items")
          .update({ pantry_item_id: null })
          .eq("household_id", hh)
          .eq("id", shoppingItemId)
          .eq("done", true)
          .eq("pantry_item_id", pantryId)
          .select("id");
        if (error) return "error";
        return !!data && data.length > 0;
      },
      async relink(pantryId) {
        await db.from("casa_shopping_items").update({ pantry_item_id: pantryId }).eq("household_id", hh).eq("id", shoppingItemId).is("pantry_item_id", null);
      },
      add: (pantryId, qty) => changeQuantity(db, hh, pantryId, qty),
    },
    q.value,
  );
  refresh();
  return r;
}

export async function deletePantryItem(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: "Item inválido." };
  const db = await createClient();
  const { data, error } = await db.from("casa_pantry_items").delete().eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: "Item não encontrado." };
  refresh();
  return { ok: true };
}

/* ---------- Tarefas domésticas ---------- */

async function loadChore(db: Db, householdId: string, id: string) {
  const { data } = await db.from("casa_chores").select(CHORE_COLS).eq("household_id", householdId).eq("id", id).maybeSingle();
  return (data as Chore | null) ?? null;
}

const sameList = <T,>(a: T[] | null, b: T[] | null) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export async function saveChore(_: CasaState, form: FormData): Promise<CasaState> {
  const ctx = await getAppContext();
  // Rodízio validado contra os members da família no servidor (o trigger do banco confere de novo).
  const parsed = validateChoreInput(formToObject(form, ["weekdays", "rotation"]), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Tarefa inválida." };
  const db = await createClient();
  const v = parsed.value;
  if (id) {
    const old = await loadChore(db, ctx.household.id, id);
    if (!old) return { error: "Tarefa não encontrada." };
    const scheduleChanged = old.frequency !== v.frequency || !sameList(old.weekdays, v.weekdays) || old.month_day !== v.month_day;
    const patch = {
      ...v,
      next_index: sameList(old.rotation, v.rotation) ? old.next_index : 0,
      next_due_on: scheduleChanged || !old.next_due_on ? firstDueOn(v, today()) : old.next_due_on,
    };
    const { data, error } = await db.from("casa_chores").update(patch).eq("household_id", ctx.household.id).eq("id", id).select("id");
    if (error) return { error: choreDbError(error.code) };
    if (!data || data.length === 0) return { error: "Tarefa não encontrada." };
  } else {
    const { error } = await db
      .from("casa_chores")
      .insert({ ...v, household_id: ctx.household.id, next_index: 0, next_due_on: firstDueOn(v, today()) });
    if (error) return { error: choreDbError(error.code) };
  }
  refresh();
  return { ok: true, message: id ? "Tarefa atualizada." : "Tarefa criada." };
}

/** Repo das tarefas para completeChoreWith/skipChoreWith: updates condicionados a índice e data esperados. */
function choreRepo(db: Db, householdId: string, id: string): ChoreRepo {
  return {
    read: () => loadChore(db, householdId, id),
    async updateIf(expected, patch) {
      let q = db.from("casa_chores").update(patch).eq("household_id", householdId).eq("id", id).eq("next_index", expected.next_index);
      q = expected.next_due_on ? q.eq("next_due_on", expected.next_due_on) : q.is("next_due_on", null);
      const { data, error } = await q.select("id");
      if (error) return { code: error.code };
      return !!data && data.length > 0;
    },
    async insertLog(row) {
      const { error } = await db.from("casa_chore_log").insert({ household_id: householdId, chore_id: id, ...row });
      return !error;
    },
  };
}

/** Estado que a tela mostrou (índice e data); vem do navegador, então é validado aqui. */
function parseExpected(e: unknown): Expected | null {
  if (!e || typeof e !== "object") return null;
  const { next_index, next_due_on } = e as Record<string, unknown>;
  if (!Number.isInteger(next_index) || (next_index as number) < 0 || (next_index as number) > 100) return null;
  if (next_due_on !== null && !isDate(next_due_on)) return null;
  return { next_index: next_index as number, next_due_on: next_due_on as string | null };
}

/** "Feita": avança o rodízio e a data e grava o histórico com o responsável da vez (desfaz o avanço se o histórico falhar). */
export async function completeChore(id: string, expected: Expected): Promise<Result> {
  const ctx = await getAppContext();
  const exp = parseExpected(expected);
  if (!isUuid(id) || !exp) return { ok: false, erro: "Tarefa inválida." };
  const db = await createClient();
  // Ids de members apagados que ficaram no rodízio são pulados.
  const r = await completeChoreWith(choreRepo(db, ctx.household.id, id), exp, today(), new Set(ctx.members.map((m) => m.id)), choreDbError);
  refresh();
  return r;
}

/** "Pular a vez": passa para a próxima pessoa sem mudar a data nem gravar histórico. */
export async function skipChoreTurn(id: string, expected: Expected): Promise<Result> {
  const ctx = await getAppContext();
  const exp = parseExpected(expected);
  if (!isUuid(id) || !exp) return { ok: false, erro: "Tarefa inválida." };
  const db = await createClient();
  const r = await skipChoreWith(choreRepo(db, ctx.household.id, id), exp, new Set(ctx.members.map((m) => m.id)), choreDbError);
  refresh();
  return r;
}

export async function deleteChore(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: "Tarefa inválida." };
  const db = await createClient();
  const { data, error } = await db.from("casa_chores").delete().eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: "Tarefa não encontrada." };
  refresh();
  return { ok: true };
}

/* ---------- Manutenção ---------- */

export async function saveMaintenance(_: CasaState, form: FormData): Promise<CasaState> {
  const ctx = await getAppContext();
  const parsed = validateMaintenanceInput(formToObject(form), today());
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Manutenção inválida." };
  const v = parsed.value;
  const values = { ...v, next_due_on: nextMaintenanceDue(v.last_done_on, v.interval_value, v.interval_unit) };
  const db = await createClient();
  if (id) {
    const { data, error } = await db.from("casa_maintenance").update(values).eq("household_id", ctx.household.id).eq("id", id).select("id");
    if (error) return { error: GENERIC };
    if (!data || data.length === 0) return { error: "Manutenção não encontrada." };
  } else {
    const { error } = await db.from("casa_maintenance").insert({ ...values, household_id: ctx.household.id });
    if (error) return { error: GENERIC };
  }
  refresh();
  return { ok: true, message: id ? "Manutenção atualizada." : "Manutenção salva." };
}

/** "Feita" (hoje ou outra data): grava o histórico com custo opcional e recalcula a próxima data. */
export async function markMaintenanceDone(_: CasaState, form: FormData): Promise<CasaState> {
  const ctx = await getAppContext();
  const id = String(form.get("id") ?? "");
  if (!isUuid(id)) return { error: "Manutenção inválida." };
  const parsed = validateMaintenanceDone(formToObject(form), today());
  if (!parsed.ok) return { error: parsed.erro };
  const db = await createClient();
  const { data: m } = await db.from("casa_maintenance").select(MAINTENANCE_COLS).eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!m) return { error: "Manutenção não encontrada." };
  const item = m as Maintenance;
  const { error: logErr } = await db.from("casa_maintenance_log").insert({ household_id: ctx.household.id, maintenance_id: id, ...parsed.value });
  if (logErr) return { error: GENERIC };
  // Data antiga registrada depois não faz a "última vez" voltar no tempo.
  const last = item.last_done_on && item.last_done_on > parsed.value.done_on ? item.last_done_on : parsed.value.done_on;
  const { error } = await db
    .from("casa_maintenance")
    .update({ last_done_on: last, next_due_on: nextMaintenanceDue(last, item.interval_value, item.interval_unit) })
    .eq("household_id", ctx.household.id)
    .eq("id", id);
  refresh();
  if (error) return { error: "O histórico foi gravado, mas a próxima data não foi recalculada." };
  return { ok: true, message: "Manutenção registrada." };
}

export async function deleteMaintenance(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: "Manutenção inválida." };
  const db = await createClient();
  const { data, error } = await db.from("casa_maintenance").delete().eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: "Manutenção não encontrada." };
  refresh();
  return { ok: true };
}
