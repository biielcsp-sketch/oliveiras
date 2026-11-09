"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { addDays, isDate } from "@/lib/agenda/dates";
import { eventInputFromForm, validateEventInput } from "@/lib/agenda/input";
import type { AgendaEvent } from "@/lib/agenda/view";
import {
  agendaEnabled,
  createEvent,
  decryptRefreshToken,
  getEventsBetween,
  removeEvent,
  syncFamily,
  updateEvent,
  type AgendaSyncResult,
} from "@/lib/google/agenda";
import { forgetAccessToken, revokeToken } from "@/lib/google/oauth";

export type AgendaFormState = { ok?: boolean; error?: string; message?: string } | null;

function refresh() {
  revalidatePath("/agenda");
}

function describe(r: AgendaSyncResult): string {
  if (r.status === "skipped") {
    return { "nao-liberado": "Agenda não liberada.", "sem-contas": "Nenhuma conta Google conectada.", recente: "Já sincronizado há pouco." }[
      r.reason
    ];
  }
  return `Sincronizado: ${r.upserted} eventos atualizados, ${r.removed} removidos.${r.errors.length ? ` Atenção: ${r.errors[0]}` : ""}`;
}

/** Ao abrir a Agenda ou o calendário do topo: sincroniza se passou de 5 minutos. */
export async function autoSyncAgenda(): Promise<{ changed: boolean }> {
  try {
    const r = await syncFamily({ force: false });
    const changed = r.status === "done";
    if (changed) refresh();
    return { changed };
  } catch {
    return { changed: false };
  }
}

export async function syncAgendaNow(): Promise<AgendaFormState> {
  try {
    const r = await syncFamily({ force: true });
    refresh();
    return r.status === "done" && r.errors.length ? { error: describe(r) } : { ok: true, message: describe(r) };
  } catch {
    return { error: "Não foi possível sincronizar agora." };
  }
}

/** Criar (sem id) ou editar (com id) evento: grava no Google e espelha aqui. */
export async function saveEvent(_: AgendaFormState, form: FormData): Promise<AgendaFormState> {
  const ctx = await getAppContext();
  const parsed = validateEventInput(eventInputFromForm(form));
  if (!parsed.ok) return { error: parsed.erro };
  const id = String(form.get("id") ?? "");
  let r;
  if (id) {
    if (!UUID_RE.test(id)) return { error: "Evento inválido." };
    r = await updateEvent(ctx, id, parsed.value);
  } else {
    const calendarId = String(form.get("calendar_id") ?? "");
    if (!UUID_RE.test(calendarId)) return { error: "Escolha a agenda." };
    r = await createEvent(ctx, calendarId, parsed.value);
  }
  refresh();
  return r.ok ? { ok: true, message: id ? "Evento atualizado." : "Evento criado." } : { error: r.erro };
}

export async function deleteAgendaEvent(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Evento inválido." };
  const r = await removeEvent(ctx, id);
  refresh();
  return r.ok ? { ok: true } : { ok: false, erro: r.erro };
}

/** Liga/desliga uma agenda (só o dono da conta). Desligar apaga a cópia local; religar refaz a carga. */
export async function toggleCalendar(form: FormData) {
  const ctx = await getAppContext();
  const id = String(form.get("id") ?? "");
  const selected = form.get("selected") === "true";
  if (!UUID_RE.test(id) || !agendaEnabled(ctx.household.id)) return;
  const db = await createClient();
  const { data: cal } = await db.from("cal_calendars").select("id, account_ref").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!cal) return;
  const { data: acc } = await db.from("google_accounts").select("member_id").eq("household_id", ctx.household.id).eq("id", cal.account_ref).maybeSingle();
  if (!acc || acc.member_id !== ctx.me?.id) return;
  await db.from("cal_calendars").update({ selected, sync_token: null }).eq("id", id).eq("household_id", ctx.household.id);
  if (!selected) await db.from("cal_events").delete().eq("household_id", ctx.household.id).eq("calendar_ref", id);
  else await syncFamily({ force: true }).catch(() => null);
  refresh();
}

/** Desconectar: revoga no Google e apaga a conta (agendas e eventos saem em cascata). Só o dono. */
export async function disconnectGoogle(_: AgendaFormState, form: FormData): Promise<AgendaFormState> {
  const ctx = await getAppContext();
  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Conta inválida." };
  const db = await createClient();
  const { data: acc } = await db
    .from("google_accounts")
    .select("id, household_id, member_id, google_sub, token_ciphertext")
    .eq("household_id", ctx.household.id)
    .eq("id", id)
    .maybeSingle();
  if (!acc || acc.member_id !== ctx.me?.id) return { error: "Só a própria pessoa pode desconectar a conta dela." };

  let revoked = false;
  try {
    revoked = await revokeToken(decryptRefreshToken(acc));
  } catch {
    revoked = false;
  }
  forgetAccessToken(acc.id);
  const { error } = await db.from("google_accounts").delete().eq("id", acc.id).eq("household_id", ctx.household.id);
  refresh();
  if (error) return { error: "Não foi possível desconectar." };
  return revoked
    ? { ok: true, message: "Conta Google desconectada." }
    : { ok: true, message: "Conta removida do app, mas o Google não confirmou a revogação. Remova o acesso em myaccount.google.com/permissions." };
}

/** Eventos de um mês (calendário do topo). */
export async function getMonthEvents(month: string): Promise<{ enabled: boolean; events: AgendaEvent[] }> {
  const ctx = await getAppContext();
  if (typeof month !== "string" || !isDate(`${month}-01`)) return { enabled: false, events: [] };
  if (!agendaEnabled(ctx.household.id)) return { enabled: false, events: [] };
  const from = `${month}-01`;
  const to = addDays(addDays(from, 31).slice(0, 7) + "-01", -1);
  return { enabled: true, events: await getEventsBetween(ctx, from, to) };
}
