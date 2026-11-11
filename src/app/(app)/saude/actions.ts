"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { toSpDate } from "@/lib/agenda/dates";
import {
  appointmentInputFromForm,
  cardInputFromForm,
  endDateFor,
  examInputFromForm,
  medicationInputFromForm,
  procedureInputFromForm,
  STATUSES,
  vaccineInputFromForm,
  validateAppointmentInput,
  validateCardInput,
  validateExamInput,
  validateMedicationInput,
  validateProcedureInput,
  validateVaccineInput,
} from "@/lib/saude/input";
import { checkUpload, isStoragePath, storagePath, UUID_RE, type StorageDir } from "@/lib/saude/files";
import { removeAppointmentFromAgenda, syncAppointmentToAgenda } from "@/lib/saude/agenda-sync";
import { insertAppointment, storeAgendaId } from "@/lib/saude/appointment-save";
import { APPOINTMENT_COLS, type AppointmentStatus, type HealthAppointment } from "@/lib/saude/types";

export type SaudeState = { ok?: boolean; error?: string; message?: string } | null;

const BUCKET = "saude";
const GENERIC = "Não foi possível salvar. Tente de novo.";

type Db = Awaited<ReturnType<typeof createClient>>;

function refresh() {
  revalidatePath("/saude", "layout");
}

/** Lê o arquivo do formulário (se houver), valida tamanho e tipo pelos bytes e sobe com a sessão do usuário. */
async function uploadFile(db: Db, householdId: string, dir: StorageDir, form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: true as const, uploaded: null };
  if (file.size > 5 * 1024 * 1024) return { ok: false as const, erro: "O arquivo passa de 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes);
  if (!check.ok) return { ok: false as const, erro: check.erro };
  const path = storagePath(householdId, dir, randomUUID(), check.kind.ext);
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: check.kind.mime, upsert: false });
  if (error) return { ok: false as const, erro: "Não foi possível enviar o arquivo. Tente de novo." };
  return { ok: true as const, uploaded: { path, mime: check.kind.mime, size: bytes.length } };
}

async function removeFile(db: Db, path: string | null | undefined) {
  if (path && isStoragePath(path)) await db.storage.from(BUCKET).remove([path]);
}

type FileTable = "health_insurance_cards" | "health_exams" | "health_procedures" | "health_vaccines";
type Result = { ok: boolean; erro?: string };

/**
 * Salva (insert/update) uma linha que pode ter arquivo, sempre com a sessão do usuário e o household do servidor.
 * Arquivo novo que não chegou a ser referenciado (erro ou 0 linhas afetadas) é apagado; o antigo só sai depois do sucesso.
 */
async function saveWithFile(opts: {
  table: FileTable;
  dir: StorageDir;
  form: FormData;
  householdId: string;
  values: Record<string, unknown>;
  invalid: string;
  notFound: string;
  requireFile?: string;
  allowRemove?: boolean;
  saved: [string, string];
}): Promise<SaudeState> {
  const { table, dir, form, householdId, values } = opts;
  const id = String(form.get("id") ?? "");
  if (id && !UUID_RE.test(id)) return { error: opts.invalid };
  const db = await createClient();

  let old: { file_path: string | null } | null = null;
  if (id) {
    const { data } = await db.from(table).select("file_path").eq("household_id", householdId).eq("id", id).maybeSingle();
    if (!data) return { error: opts.notFound };
    old = data;
  }
  const up = await uploadFile(db, householdId, dir, form);
  if (!up.ok) return { error: up.erro };
  if (!id && opts.requireFile && !up.uploaded) return { error: opts.requireFile };

  const removeOld = !!opts.allowRemove && form.get("remove_file") === "on" && !up.uploaded;
  const fileCols = up.uploaded
    ? { file_path: up.uploaded.path, file_mime: up.uploaded.mime, file_size: up.uploaded.size }
    : removeOld
      ? { file_path: null, file_mime: null, file_size: null }
      : {};

  let failed: string | null = null;
  if (id) {
    const { data, error } = await db.from(table).update({ ...values, ...fileCols }).eq("household_id", householdId).eq("id", id).select("id");
    if (error) failed = GENERIC;
    else if (!data || data.length === 0) failed = opts.notFound; // 0 linhas: o registro sumiu ou não é da família
  } else {
    const { error } = await db.from(table).insert({ ...values, ...fileCols, household_id: householdId });
    if (error) failed = GENERIC;
  }
  if (failed) {
    await removeFile(db, up.uploaded?.path);
    return { error: failed };
  }
  if ((up.uploaded || removeOld) && old) await removeFile(db, old.file_path);
  refresh();
  return { ok: true, message: id ? opts.saved[1] : opts.saved[0] };
}

async function deleteWithFile(table: FileTable, id: string, invalid: string, notFound: string): Promise<Result> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: invalid };
  const db = await createClient();
  const { data } = await db.from(table).select("file_path").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: notFound };
  const { error } = await db.from(table).delete().eq("household_id", ctx.household.id).eq("id", id);
  if (error) return { ok: false, erro: "Não foi possível remover." };
  await removeFile(db, data.file_path);
  refresh();
  return { ok: true };
}

/* ---------- Carteirinhas ---------- */

export async function saveCard(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateCardInput(cardInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  return saveWithFile({
    table: "health_insurance_cards",
    dir: "cards",
    form,
    householdId: ctx.household.id,
    values: parsed.value,
    invalid: "Carteirinha inválida.",
    notFound: "Carteirinha não encontrada.",
    requireFile: "Anexe o PDF ou a foto (JPG) da carteirinha.",
    saved: ["Carteirinha salva.", "Carteirinha atualizada."],
  });
}

export async function deleteCard(id: string): Promise<Result> {
  return deleteWithFile("health_insurance_cards", id, "Carteirinha inválida.", "Carteirinha não encontrada.");
}

/* ---------- Exames ---------- */

export async function saveExam(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateExamInput(examInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  return saveWithFile({
    table: "health_exams",
    dir: "exams",
    form,
    householdId: ctx.household.id,
    values: parsed.value,
    invalid: "Exame inválido.",
    notFound: "Exame não encontrado.",
    allowRemove: true,
    saved: ["Exame salvo.", "Exame atualizado."],
  });
}

export async function deleteExam(id: string): Promise<Result> {
  return deleteWithFile("health_exams", id, "Exame inválido.", "Exame não encontrado.");
}

/* ---------- Procedimentos ---------- */

export async function saveProcedure(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateProcedureInput(procedureInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  return saveWithFile({
    table: "health_procedures",
    dir: "procedures",
    form,
    householdId: ctx.household.id,
    values: parsed.value,
    invalid: "Procedimento inválido.",
    notFound: "Procedimento não encontrado.",
    allowRemove: true,
    saved: ["Procedimento salvo.", "Procedimento atualizado."],
  });
}

export async function deleteProcedure(id: string): Promise<Result> {
  return deleteWithFile("health_procedures", id, "Procedimento inválido.", "Procedimento não encontrado.");
}

/* ---------- Vacinas ---------- */

export async function saveVaccine(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateVaccineInput(vaccineInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  return saveWithFile({
    table: "health_vaccines",
    dir: "vaccines",
    form,
    householdId: ctx.household.id,
    values: parsed.value,
    invalid: "Vacina inválida.",
    notFound: "Vacina não encontrada.",
    allowRemove: true,
    saved: ["Vacina salva.", "Vacina atualizada."],
  });
}

export async function deleteVaccine(id: string): Promise<Result> {
  return deleteWithFile("health_vaccines", id, "Vacina inválida.", "Vacina não encontrada.");
}

/* ---------- Medicamentos (sem arquivo) ---------- */

export async function saveMedication(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateMedicationInput(medicationInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !UUID_RE.test(id)) return { error: "Medicamento inválido." };
  const db = await createClient();
  if (id) {
    const { data, error } = await db.from("health_medications").update(parsed.value).eq("household_id", ctx.household.id).eq("id", id).select("id");
    if (error) return { error: GENERIC };
    if (!data || data.length === 0) return { error: "Medicamento não encontrado." };
  } else {
    const { error } = await db.from("health_medications").insert({ ...parsed.value, household_id: ctx.household.id });
    if (error) return { error: GENERIC };
  }
  refresh();
  return { ok: true, message: id ? "Medicamento atualizado." : "Medicamento salvo." };
}

/** Encerra (active=false + ended_on) ou reativa (active=true, ended_on=null). */
export async function setMedicationActive(id: string, active: boolean): Promise<Result> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id) || typeof active !== "boolean") return { ok: false, erro: "Pedido inválido." };
  const db = await createClient();
  const { data: before } = await db.from("health_medications").select("started_on").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!before) return { ok: false, erro: "Medicamento não encontrado." };
  const patch = active ? { active: true, ended_on: null } : { active: false, ended_on: endDateFor(before.started_on, toSpDate(new Date())) };
  const { data, error } = await db.from("health_medications").update(patch).eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error || !data || data.length === 0) return { ok: false, erro: "Não foi possível atualizar." };
  refresh();
  return { ok: true };
}

export async function deleteMedication(id: string): Promise<Result> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Medicamento inválido." };
  const db = await createClient();
  const { data, error } = await db.from("health_medications").delete().eq("household_id", ctx.household.id).eq("id", id).select("id");
  if (error) return { ok: false, erro: "Não foi possível remover." };
  if (!data || data.length === 0) return { ok: false, erro: "Medicamento não encontrado." };
  refresh();
  return { ok: true };
}

/* ---------- Consultas e retornos ---------- */

async function loadAppointment(db: Db, householdId: string, id: string) {
  const { data } = await db.from("health_appointments").select(APPOINTMENT_COLS).eq("household_id", householdId).eq("id", id).maybeSingle();
  return (data as HealthAppointment | null) ?? null;
}

export async function saveAppointment(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateAppointmentInput(appointmentInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !UUID_RE.test(id)) return { error: "Consulta inválida." };
  const db = await createClient();
  const value = { ...parsed.value };

  if (value.return_of) {
    // O retorno aponta para uma consulta (não retorno) da mesma pessoa e família, e nunca para si mesmo.
    const origin = value.return_of === id ? null : await loadAppointment(db, ctx.household.id, value.return_of);
    if (!origin || origin.kind !== "consulta" || origin.member_id !== value.member_id) return { error: "Escolha uma consulta da mesma pessoa." };
  }

  let saved: HealthAppointment;
  if (id) {
    const before = await loadAppointment(db, ctx.household.id, id);
    if (!before) return { error: "Consulta não encontrada." };
    const { error } = await db.from("health_appointments").update(value).eq("household_id", ctx.household.id).eq("id", id);
    if (error) return { error: GENERIC };
    saved = { ...before, ...value };
  } else {
    const r = await insertAppointment(db, ctx, value);
    if (!r.ok) return { error: GENERIC };
    refresh();
    return { ok: true, message: "Consulta salva." };
  }
  await storeAgendaId(db, ctx.household.id, saved, await syncAppointmentToAgenda(ctx, saved));
  refresh();
  return { ok: true, message: "Consulta atualizada." };
}

export async function setAppointmentStatus(id: string, status: AppointmentStatus): Promise<{ ok: boolean; erro?: string }> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id) || !STATUSES.includes(status)) return { ok: false, erro: "Pedido inválido." };
  const db = await createClient();
  const before = await loadAppointment(db, ctx.household.id, id);
  if (!before) return { ok: false, erro: "Consulta não encontrada." };
  const { error } = await db.from("health_appointments").update({ status }).eq("household_id", ctx.household.id).eq("id", id);
  if (error) return { ok: false, erro: "Não foi possível atualizar." };
  const saved = { ...before, status };
  await storeAgendaId(db, ctx.household.id, saved, await syncAppointmentToAgenda(ctx, saved));
  refresh();
  return { ok: true };
}

/** Botão "Tentar de novo" da consulta não sincronizada. */
export async function retryAgendaSync(id: string): Promise<{ ok: boolean; erro?: string }> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Consulta inválida." };
  const db = await createClient();
  const a = await loadAppointment(db, ctx.household.id, id);
  if (!a) return { ok: false, erro: "Consulta não encontrada." };
  const eventId = await syncAppointmentToAgenda(ctx, a);
  await storeAgendaId(db, ctx.household.id, a, eventId);
  refresh();
  return eventId ? { ok: true } : { ok: false, erro: "Não foi possível sincronizar com a Agenda agora." };
}

export async function deleteAppointment(id: string): Promise<{ ok: boolean; erro?: string }> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Consulta inválida." };
  const db = await createClient();
  const a = await loadAppointment(db, ctx.household.id, id);
  if (!a) return { ok: false, erro: "Consulta não encontrada." };
  const { error } = await db.from("health_appointments").delete().eq("household_id", ctx.household.id).eq("id", id);
  if (error) return { ok: false, erro: "Não foi possível apagar." };
  await removeAppointmentFromAgenda(ctx, a.agenda_event_id);
  refresh();
  return { ok: true };
}
