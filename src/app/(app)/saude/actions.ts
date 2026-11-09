"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import {
  appointmentInputFromForm,
  cardInputFromForm,
  examInputFromForm,
  STATUSES,
  validateAppointmentInput,
  validateCardInput,
  validateExamInput,
} from "@/lib/saude/input";
import { checkUpload, isStoragePath, storagePath, UUID_RE, type StorageDir } from "@/lib/saude/files";
import { removeAppointmentFromAgenda, syncAppointmentToAgenda } from "@/lib/saude/agenda-sync";
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

/* ---------- Carteirinhas ---------- */

export async function saveCard(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateCardInput(cardInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !UUID_RE.test(id)) return { error: "Carteirinha inválida." };
  const db = await createClient();

  let old: { file_path: string } | null = null;
  if (id) {
    const { data } = await db.from("health_insurance_cards").select("file_path").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
    if (!data) return { error: "Carteirinha não encontrada." };
    old = data;
  }
  const up = await uploadFile(db, ctx.household.id, "cards", form);
  if (!up.ok) return { error: up.erro };
  if (!id && !up.uploaded) return { error: "Anexe o PDF ou a foto (JPG) da carteirinha." };

  const fileCols = up.uploaded ? { file_path: up.uploaded.path, file_mime: up.uploaded.mime, file_size: up.uploaded.size } : {};
  const { error } = id
    ? await db.from("health_insurance_cards").update({ ...parsed.value, ...fileCols }).eq("household_id", ctx.household.id).eq("id", id)
    : await db.from("health_insurance_cards").insert({ ...parsed.value, ...fileCols, household_id: ctx.household.id });
  if (error) {
    await removeFile(db, up.uploaded?.path);
    return { error: GENERIC };
  }
  if (up.uploaded && old) await removeFile(db, old.file_path);
  refresh();
  return { ok: true, message: id ? "Carteirinha atualizada." : "Carteirinha salva." };
}

export async function deleteCard(id: string): Promise<{ ok: boolean; erro?: string }> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Carteirinha inválida." };
  const db = await createClient();
  const { data } = await db.from("health_insurance_cards").select("file_path").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Carteirinha não encontrada." };
  const { error } = await db.from("health_insurance_cards").delete().eq("household_id", ctx.household.id).eq("id", id);
  if (error) return { ok: false, erro: "Não foi possível remover." };
  await removeFile(db, data.file_path);
  refresh();
  return { ok: true };
}

/* ---------- Exames ---------- */

export async function saveExam(_: SaudeState, form: FormData): Promise<SaudeState> {
  const ctx = await getAppContext();
  const parsed = validateExamInput(examInputFromForm(form), ctx.members.map((m) => m.id));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  if (id && !UUID_RE.test(id)) return { error: "Exame inválido." };
  const db = await createClient();

  let old: { file_path: string | null } | null = null;
  if (id) {
    const { data } = await db.from("health_exams").select("file_path").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
    if (!data) return { error: "Exame não encontrado." };
    old = data;
  }
  const up = await uploadFile(db, ctx.household.id, "exams", form);
  if (!up.ok) return { error: up.erro };

  const removeOld = form.get("remove_file") === "on" && !up.uploaded;
  const fileCols = up.uploaded
    ? { file_path: up.uploaded.path, file_mime: up.uploaded.mime, file_size: up.uploaded.size }
    : removeOld
      ? { file_path: null, file_mime: null, file_size: null }
      : {};
  const { error } = id
    ? await db.from("health_exams").update({ ...parsed.value, ...fileCols }).eq("household_id", ctx.household.id).eq("id", id)
    : await db.from("health_exams").insert({ ...parsed.value, ...fileCols, household_id: ctx.household.id });
  if (error) {
    await removeFile(db, up.uploaded?.path);
    return { error: GENERIC };
  }
  if ((up.uploaded || removeOld) && old) await removeFile(db, old.file_path);
  refresh();
  return { ok: true, message: id ? "Exame atualizado." : "Exame salvo." };
}

export async function deleteExam(id: string): Promise<{ ok: boolean; erro?: string }> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Exame inválido." };
  const db = await createClient();
  const { data } = await db.from("health_exams").select("file_path").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Exame não encontrado." };
  const { error } = await db.from("health_exams").delete().eq("household_id", ctx.household.id).eq("id", id);
  if (error) return { ok: false, erro: "Não foi possível remover." };
  await removeFile(db, data.file_path);
  refresh();
  return { ok: true };
}

/* ---------- Consultas e retornos ---------- */

async function loadAppointment(db: Db, householdId: string, id: string) {
  const { data } = await db.from("health_appointments").select(APPOINTMENT_COLS).eq("household_id", householdId).eq("id", id).maybeSingle();
  return (data as HealthAppointment | null) ?? null;
}

/** Grava o resultado da sincronização com a Agenda (best-effort, nunca derruba a consulta). */
async function storeAgendaId(db: Db, householdId: string, a: HealthAppointment, eventId: string | null) {
  if (eventId === a.agenda_event_id) return;
  await db.from("health_appointments").update({ agenda_event_id: eventId }).eq("household_id", householdId).eq("id", a.id);
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

  let saved: HealthAppointment | null;
  if (id) {
    const before = await loadAppointment(db, ctx.household.id, id);
    if (!before) return { error: "Consulta não encontrada." };
    const { error } = await db.from("health_appointments").update(value).eq("household_id", ctx.household.id).eq("id", id);
    if (error) return { error: GENERIC };
    saved = { ...before, ...value };
  } else {
    const { data, error } = await db
      .from("health_appointments")
      .insert({ ...value, household_id: ctx.household.id })
      .select(APPOINTMENT_COLS)
      .single();
    if (error) return { error: GENERIC };
    saved = data as HealthAppointment;
  }
  await storeAgendaId(db, ctx.household.id, saved, await syncAppointmentToAgenda(ctx, saved));
  refresh();
  return { ok: true, message: id ? "Consulta atualizada." : "Consulta salva." };
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
