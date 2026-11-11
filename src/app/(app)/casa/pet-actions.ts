"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { toSpDate } from "@/lib/agenda/dates";
import { formToObject, isUuid, validateShoppingInput } from "@/lib/casa/input";
import { ingredientsToAdd } from "@/lib/casa/menu";
import { fileColumns, removeCasaFile, uploadCasaFile } from "@/lib/casa/storage";
import { completeCareWith, foodShoppingName, nextCareDue, PET_CARE_COLS, type CareState } from "@/lib/casa/pet";
import {
  parseCareExpected,
  validatePetCareDone,
  validatePetCareInput,
  validatePetFoodInput,
  validatePetHealthInput,
  validatePetInput,
  validatePetVetInput,
  validatePetWeightInput,
} from "@/lib/casa/pet-input";

/**
 * Aba Pet da Casa. household_id sempre de getAppContext(); pet e prestador conferidos na família antes de gravar
 * (as FKs compostas (x, household_id) da 0018 recusam de novo). Anexos: mesmo upload dos documentos da Casa
 * (bytes PDF/JPG, até 5 MB, nome uuid em {household_id}/pets/), lidos só pela rota autenticada.
 */
export type PetState = { ok?: boolean; error?: string; message?: string; id?: string } | null;
type Result = { ok: boolean; erro?: string; message?: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const GENERIC = "Não foi possível salvar. Tente de novo.";
const PET_ERR = "Pet não encontrado.";
const PROVIDER_ERR = "Escolha um prestador da família (ele pode ter sido apagado).";

const today = () => toSpDate(new Date());

function refresh() {
  revalidatePath("/casa", "layout");
}

async function petOfHousehold(db: Db, hh: string, petId: string) {
  const { data } = await db.from("casa_pets").select("id").eq("household_id", hh).eq("id", petId).maybeSingle();
  return !!data;
}

/** 23503 = FK composta: pet ou prestador de outra família (ou apagado no meio). */
const fkError = (code: string | undefined, msg: string) => (code === "23503" ? msg : GENERIC);

async function deleteById(table: string, id: string, notFound: string, cols = "id"): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; erro: string }> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: notFound };
  const db = await createClient();
  const { data, error } = await db.from(table).delete().eq("household_id", ctx.household.id).eq("id", id).select(cols);
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: notFound };
  return { ok: true, rows: data as unknown as Record<string, unknown>[] };
}

/* ---------- Pet ---------- */

export async function savePet(_: PetState, form: FormData): Promise<PetState> {
  const ctx = await getAppContext();
  const parsed = validatePetInput(formToObject(form), today());
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: PET_ERR };
  const db = await createClient();
  if (id) {
    const { data, error } = await db.from("casa_pets").update(parsed.value).eq("household_id", ctx.household.id).eq("id", id).select("id");
    if (error) return { error: GENERIC };
    if (!data || data.length === 0) return { error: PET_ERR };
    refresh();
    return { ok: true, message: `${parsed.value.name} atualizado.`, id };
  }
  const { data, error } = await db.from("casa_pets").insert({ ...parsed.value, household_id: ctx.household.id }).select("id").single();
  if (error || !data) return { error: GENERIC };
  refresh();
  return { ok: true, message: `${parsed.value.name} cadastrado.`, id: data.id as string };
}

/** Apaga o pet e tudo dele (cascade no banco); os anexos saem do bucket depois. */
export async function deletePet(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: PET_ERR };
  const db = await createClient();
  const hh = ctx.household.id;
  const [h, v] = await Promise.all([
    db.from("casa_pet_health").select("file_path").eq("household_id", hh).eq("pet_id", id).not("file_path", "is", null).limit(1000),
    db.from("casa_pet_vet").select("file_path").eq("household_id", hh).eq("pet_id", id).not("file_path", "is", null).limit(1000),
  ]);
  const { data, error } = await db.from("casa_pets").delete().eq("household_id", hh).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: PET_ERR };
  for (const r of [...(h.data ?? []), ...(v.data ?? [])]) await removeCasaFile(db, r.file_path as string | null, "pets");
  refresh();
  return { ok: true };
}

/* ---------- Registros com anexo (vacinas/remédios e veterinário) ---------- */

/**
 * Novo ou edição com anexo opcional. Arquivo novo não referenciado (erro ou 0 linhas) é apagado;
 * o antigo só sai depois do sucesso.
 */
async function saveWithFile(table: "casa_pet_health" | "casa_pet_vet", values: Record<string, unknown> & { pet_id: string }, form: FormData, labels: { notFound: string; saved: string; updated: string }): Promise<PetState> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: labels.notFound };
  const db = await createClient();
  if (!(await petOfHousehold(db, hh, values.pet_id))) return { error: PET_ERR };

  let old: { file_path: string | null } | null = null;
  if (id) {
    const { data } = await db.from(table).select("file_path").eq("household_id", hh).eq("id", id).maybeSingle();
    if (!data) return { error: labels.notFound };
    old = data as { file_path: string | null };
  }
  const up = await uploadCasaFile(db, hh, form, "pets");
  if (!up.ok) return { error: up.erro };
  const removeOld = form.get("remove_file") === "on" && !up.uploaded;
  const row = { ...values, ...fileColumns(up.uploaded, removeOld) };

  let failed: string | null = null;
  if (id) {
    const { data, error } = await db.from(table).update(row).eq("household_id", hh).eq("id", id).select("id");
    if (error) failed = fkError(error.code, PET_ERR);
    else if (!data || data.length === 0) failed = labels.notFound;
  } else {
    const { error } = await db.from(table).insert({ ...row, household_id: hh });
    if (error) failed = fkError(error.code, PET_ERR);
  }
  if (failed) {
    await removeCasaFile(db, up.uploaded?.path, "pets");
    return { error: failed };
  }
  if ((up.uploaded || removeOld) && old) await removeCasaFile(db, old.file_path, "pets");
  refresh();
  return { ok: true, message: id ? labels.updated : labels.saved };
}

export async function savePetHealth(_: PetState, form: FormData): Promise<PetState> {
  const parsed = validatePetHealthInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  return saveWithFile("casa_pet_health", parsed.value, form, { notFound: "Registro não encontrado.", saved: `${parsed.value.name} salvo.`, updated: `${parsed.value.name} atualizado.` });
}

export async function deletePetHealth(id: string): Promise<Result> {
  const r = await deleteById("casa_pet_health", id, "Registro não encontrado.", "file_path");
  if (!r.ok) return r;
  await removeCasaFile(await createClient(), r.rows[0].file_path as string | null, "pets");
  refresh();
  return { ok: true };
}

export async function savePetVet(_: PetState, form: FormData): Promise<PetState> {
  const parsed = validatePetVetInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  return saveWithFile("casa_pet_vet", parsed.value, form, { notFound: "Registro não encontrado.", saved: "Registro do veterinário salvo.", updated: "Registro do veterinário atualizado." });
}

export async function deletePetVet(id: string): Promise<Result> {
  const r = await deleteById("casa_pet_vet", id, "Registro não encontrado.", "file_path");
  if (!r.ok) return r;
  await removeCasaFile(await createClient(), r.rows[0].file_path as string | null, "pets");
  refresh();
  return { ok: true };
}

/* ---------- Cuidados recorrentes ---------- */

export async function savePetCare(_: PetState, form: FormData): Promise<PetState> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  const parsed = validatePetCareInput(formToObject(form), today());
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Cuidado não encontrado." };
  const v = parsed.value;
  const db = await createClient();
  if (!(await petOfHousehold(db, hh, v.pet_id))) return { error: PET_ERR };
  if (v.provider_id) {
    const { data: p } = await db.from("casa_providers").select("id").eq("household_id", hh).eq("id", v.provider_id).maybeSingle();
    if (!p) return { error: PROVIDER_ERR };
  }
  const values = { ...v, next_due_on: nextCareDue(v.last_done_on, v.interval_value, v.interval_unit) };
  const dbErr = (code?: string) => fkError(code, PROVIDER_ERR);
  if (id) {
    const { data, error } = await db.from("casa_pet_care").update(values).eq("household_id", hh).eq("id", id).select("id");
    if (error) return { error: dbErr(error.code) };
    if (!data || data.length === 0) return { error: "Cuidado não encontrado." };
  } else {
    const { error } = await db.from("casa_pet_care").insert({ ...values, household_id: hh });
    if (error) return { error: dbErr(error.code) };
  }
  refresh();
  return { ok: true, message: id ? "Cuidado atualizado." : "Cuidado salvo." };
}

/** "Feita" (hoje ou outra data): histórico com custo opcional e próxima data recalculada com update condicional. */
export async function markPetCareDone(_: PetState, form: FormData): Promise<PetState> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  const raw = formToObject(form);
  const id = String(raw.id ?? "");
  const expected = parseCareExpected(raw);
  if (!isUuid(id) || !expected) return { error: "Cuidado não encontrado." };
  const parsed = validatePetCareDone(raw, today());
  if (!parsed.ok) return { error: parsed.erro };
  const db = await createClient();
  const r = await completeCareWith(
    {
      async read() {
        const { data } = await db.from("casa_pet_care").select(PET_CARE_COLS).eq("household_id", hh).eq("id", id).maybeSingle();
        return (data as CareState | null) ?? null;
      },
      async updateIf(exp, patch) {
        let q = db.from("casa_pet_care").update(patch).eq("household_id", hh).eq("id", id);
        q = exp.last_done_on ? q.eq("last_done_on", exp.last_done_on) : q.is("last_done_on", null);
        q = exp.next_due_on ? q.eq("next_due_on", exp.next_due_on) : q.is("next_due_on", null);
        const { data, error } = await q.select("id");
        if (error) return { code: error.code };
        return !!data && data.length > 0;
      },
      async insertLog(row) {
        const { error } = await db.from("casa_pet_care_log").insert({ household_id: hh, care_id: id, ...row });
        return !error;
      },
    },
    expected,
    parsed.value,
  );
  refresh();
  if (!r.ok) return { error: r.erro };
  return { ok: true, message: "Cuidado registrado." };
}

export async function deletePetCare(id: string): Promise<Result> {
  const r = await deleteById("casa_pet_care", id, "Cuidado não encontrado.");
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

/* ---------- Peso ---------- */

/** Uma medição por dia: registrar de novo no mesmo dia atualiza (upsert em pet_id + measured_on). */
export async function savePetWeight(_: PetState, form: FormData): Promise<PetState> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  const parsed = validatePetWeightInput(formToObject(form), today());
  if (!parsed.ok) return { error: parsed.erro };
  const v = parsed.value;
  const db = await createClient();
  if (!(await petOfHousehold(db, hh, v.pet_id))) return { error: PET_ERR };
  const { data: existing } = await db.from("casa_pet_weights").select("id").eq("household_id", hh).eq("pet_id", v.pet_id).eq("measured_on", v.measured_on).maybeSingle();
  const { error } = await db.from("casa_pet_weights").upsert({ ...v, household_id: hh }, { onConflict: "pet_id,measured_on" });
  if (error) return { error: fkError(error.code, PET_ERR) };
  refresh();
  return { ok: true, message: existing ? "Peso do dia atualizado." : "Peso registrado." };
}

export async function deletePetWeight(id: string): Promise<Result> {
  const r = await deleteById("casa_pet_weights", id, "Medição não encontrada.");
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

/* ---------- Ração ---------- */

/** Ração nova passa a ser a ativa (as anteriores do pet ficam no histórico); edição só altera a escolhida. */
export async function savePetFood(_: PetState, form: FormData): Promise<PetState> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  const parsed = validatePetFoodInput(formToObject(form), today());
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "Ração não encontrada." };
  const v = parsed.value;
  const db = await createClient();
  if (!(await petOfHousehold(db, hh, v.pet_id))) return { error: PET_ERR };
  if (id) {
    const { data, error } = await db.from("casa_pet_food").update(v).eq("household_id", hh).eq("id", id).select("id");
    if (error) return { error: fkError(error.code, PET_ERR) };
    if (!data || data.length === 0) return { error: "Ração não encontrada." };
    refresh();
    return { ok: true, message: "Ração atualizada." };
  }
  const { data, error } = await db.from("casa_pet_food").insert({ ...v, household_id: hh, active: true }).select("id").single();
  if (error || !data) return { error: fkError(error?.code, PET_ERR) };
  await db.from("casa_pet_food").update({ active: false }).eq("household_id", hh).eq("pet_id", v.pet_id).eq("active", true).neq("id", data.id as string);
  refresh();
  return { ok: true, message: "Ração salva." };
}

export async function deletePetFood(id: string): Promise<Result> {
  const r = await deleteById("casa_pet_food", id, "Ração não encontrada.");
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

/**
 * Manda a ração para a lista de compras. A marca é lida do banco (nunca do navegador) e não duplica
 * item PENDENTE com o mesmo nome (sem acento/maiúscula), como o cardápio.
 */
export async function sendFoodToShopping(foodId: string): Promise<Result> {
  const ctx = await getAppContext();
  const hh = ctx.household.id;
  if (!isUuid(foodId)) return { ok: false, erro: "Ração não encontrada." };
  const db = await createClient();
  const { data: food } = await db.from("casa_pet_food").select("brand, bag_kg").eq("household_id", hh).eq("id", foodId).maybeSingle();
  if (!food) return { ok: false, erro: "Ração não encontrada." };
  const name = foodShoppingName(food.brand as string);
  const { data: pending, error: readErr } = await db.from("casa_shopping_items").select("name").eq("household_id", hh).eq("done", false).limit(1000);
  if (readErr) return { ok: false, erro: "Não foi possível ler a lista de compras." };
  const { add } = ingredientsToAdd([name], (pending ?? []).map((p) => p.name as string));
  if (add.length === 0) return { ok: true, message: `${name} já está na lista de compras.` };
  const parsed = validateShoppingInput({ name: add[0], quantity: String(Number(food.bag_kg)), unit: "kg", category: "Pet" });
  if (!parsed.ok) return { ok: false, erro: "Não foi possível adicionar à lista." };
  const { error } = await db.from("casa_shopping_items").insert({ ...parsed.value, household_id: hh });
  if (error) return { ok: false, erro: "Não foi possível adicionar à lista." };
  refresh();
  return { ok: true, message: `${name} adicionada à lista de compras.` };
}
