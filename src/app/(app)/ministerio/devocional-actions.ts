"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { todaySP } from "@/lib/financas/today";
import { isDate } from "@/lib/agenda/dates";
import { formToObject } from "@/lib/casa/input";
import { isUuid, validatePrayerInput, validatePurposeInput, validateWordInput, IGREJA_LIMITS } from "@/lib/igreja/input";

/**
 * Vida Devocional: dados PESSOAIS. owner_id é sempre o usuário da sessão (nunca do formulário);
 * editar/apagar filtra por owner_id = usuário, então item compartilhado pelo cônjuge nunca é alterado aqui
 * (e a RLS barra do mesmo jeito).
 */
export type DevState = { ok?: boolean; error?: string; message?: string } | null;
type Result = { ok: boolean; erro?: string };

const GENERIC = "Não foi possível salvar. Tente de novo.";
const NOT_FOUND = "Item não encontrado (ou não é seu).";
const done = () => revalidatePath("/ministerio", "layout");

type Table = "igreja_words" | "igreja_prayers" | "igreja_purposes";

async function upsertOwn(table: Table, id: string, value: Record<string, unknown>): Promise<string | null> {
  const ctx = await getAppContext();
  const db = await createClient();
  if (id) {
    if (!isUuid(id)) return NOT_FOUND;
    const { data, error } = await db.from(table).update(value).eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", id).select("id");
    if (error) return GENERIC;
    if (!data?.length) return NOT_FOUND;
    return null;
  }
  const { error } = await db.from(table).insert({ ...value, household_id: ctx.household.id, owner_id: ctx.user.id });
  return error ? GENERIC : null;
}

async function deleteOwn(table: Table, id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: NOT_FOUND };
  const db = await createClient();
  const { data, error } = await db.from(table).delete().eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível apagar." };
  if (!data?.length) return { ok: false, erro: NOT_FOUND };
  done();
  return { ok: true };
}

async function patchOwn(table: Table, id: string, value: Record<string, unknown>): Promise<Result> {
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: NOT_FOUND };
  const db = await createClient();
  const { data, error } = await db.from(table).update(value).eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: GENERIC };
  if (!data?.length) return { ok: false, erro: NOT_FOUND };
  done();
  return { ok: true };
}

/* ---------- Anotações e Promessas ---------- */

export async function saveWord(_: DevState, form: FormData): Promise<DevState> {
  const parsed = validateWordInput(formToObject(form), todaySP());
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  // O tipo não muda na edição (anotação continua anotação).
  const { kind, ...rest } = parsed.value;
  const err = await upsertOwn("igreja_words", id, id ? rest : parsed.value);
  if (err) return { error: err };
  done();
  const what = kind === "promessa" ? "Promessa" : "Anotação";
  return { ok: true, message: id ? `${what} atualizada.` : `${what} salva.` };
}

export async function deleteWord(id: string) {
  return deleteOwn("igreja_words", id);
}

/** Marca a promessa como cumprida (data) ou volta para "aguardando" (null). */
export async function setPromiseFulfilled(id: string, date: string | null): Promise<Result> {
  if (date !== null && !isDate(date)) return { ok: false, erro: "Data inválida." };
  const ctx = await getAppContext();
  if (!isUuid(id)) return { ok: false, erro: NOT_FOUND };
  const db = await createClient();
  const { data, error } = await db
    .from("igreja_words")
    .update({ fulfilled_on: date })
    .eq("household_id", ctx.household.id)
    .eq("owner_id", ctx.user.id)
    .eq("kind", "promessa")
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, erro: GENERIC };
  if (!data?.length) return { ok: false, erro: NOT_FOUND };
  done();
  return { ok: true };
}

/* ---------- Orações ---------- */

export async function savePrayer(_: DevState, form: FormData): Promise<DevState> {
  const parsed = validatePrayerInput(formToObject(form), todaySP());
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  const err = await upsertOwn("igreja_prayers", id, parsed.value);
  if (err) return { error: err };
  done();
  return { ok: true, message: id ? "Oração atualizada." : "Oração salva." };
}

export async function deletePrayer(id: string) {
  return deleteOwn("igreja_prayers", id);
}

/** Respondida (com data e testemunho) ou de volta para "orando" (limpa resposta, como pede o check do banco). */
export async function answerPrayer(id: string, answer: { date: string; notes: string } | null): Promise<Result> {
  if (!answer) return patchOwn("igreja_prayers", id, { status: "orando", answered_on: null, answer_notes: null });
  const date = answer.date || todaySP();
  if (!isDate(date)) return { ok: false, erro: "Data inválida." };
  const notes = typeof answer.notes === "string" ? answer.notes.replace(/\r\n?/g, "\n").trim() : "";
  if (notes.length > IGREJA_LIMITS.answerNotes) return { ok: false, erro: `Testemunho muito longo (máximo ${IGREJA_LIMITS.answerNotes}).` };
  return patchOwn("igreja_prayers", id, { status: "respondida", answered_on: date, answer_notes: notes || null });
}

/* ---------- Propósitos ---------- */

export async function savePurpose(_: DevState, form: FormData): Promise<DevState> {
  const parsed = validatePurposeInput(formToObject(form));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  const err = await upsertOwn("igreja_purposes", id, parsed.value);
  if (err) return { error: err };
  done();
  return { ok: true, message: id ? "Propósito atualizado." : "Propósito salvo." };
}

export async function deletePurpose(id: string) {
  return deleteOwn("igreja_purposes", id);
}
