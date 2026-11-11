"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { isDate, toSpDate } from "@/lib/agenda/dates";
import { formToObject, isUuid, validateChoreInput, validateMaintenanceDone, validateMaintenanceInput, validateShoppingInput, choreDbError } from "@/lib/casa/input";
import { firstDueOn, nextMaintenanceDue } from "@/lib/casa/schedule";
import { completeChoreWith, skipChoreWith, toggleOnce, type ChoreRepo, type Expected } from "@/lib/casa/sync";
import { CHORE_COLS, MAINTENANCE_COLS, type Chore, type Maintenance } from "@/lib/casa/types";

export type CasaState = { ok?: boolean; error?: string; message?: string } | null;
type Result = { ok: boolean; erro?: string };

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

/** Marca/desmarca comprado. Só muda se ainda estiver no estado oposto (o outro celular pode ter marcado antes). */
export async function toggleShoppingItem(id: string, done: boolean): Promise<Result> {
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
          .select("id");
        if (error) return { code: error.code };
        return !!data && data.length > 0;
      },
      async exists() {
        const { data } = await db.from("casa_shopping_items").select("id").eq("household_id", hh).eq("id", id).maybeSingle();
        return !!data;
      },
    },
    done,
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true };
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

const PROVIDER_ERR = "Escolha um prestador da família (ele pode ter sido apagado).";

export async function saveMaintenance(_: CasaState, form: FormData): Promise<CasaState> {
  const ctx = await getAppContext();
  const parsed = validateMaintenanceInput(formToObject(form), today());
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Manutenção inválida." };
  const v = parsed.value;
  const values = { ...v, next_due_on: nextMaintenanceDue(v.last_done_on, v.interval_value, v.interval_unit) };
  const db = await createClient();
  // Prestador precisa ser da família (a FK composta (provider_id, household_id) da 0017 barra de novo: 23503).
  if (v.provider_id) {
    const { data: p } = await db.from("casa_providers").select("id").eq("household_id", ctx.household.id).eq("id", v.provider_id).maybeSingle();
    if (!p) return { error: PROVIDER_ERR };
  }
  const dbErr = (code?: string) => (code === "23503" ? PROVIDER_ERR : GENERIC);
  if (id) {
    const { data, error } = await db.from("casa_maintenance").update(values).eq("household_id", ctx.household.id).eq("id", id).select("id");
    if (error) return { error: dbErr(error.code) };
    if (!data || data.length === 0) return { error: "Manutenção não encontrada." };
  } else {
    const { error } = await db.from("casa_maintenance").insert({ ...values, household_id: ctx.household.id });
    if (error) return { error: dbErr(error.code) };
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
