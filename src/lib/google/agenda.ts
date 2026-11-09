import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { agendaAllowedFor } from "@/lib/family-access";
import { todaySP } from "@/lib/financas/today";
import { spMidnightIso, addDays } from "@/lib/agenda/dates";
import {
  defaultSelected,
  planEventChanges,
  staleAfterFullSync,
  syncWindow,
  toCalendarRow,
  toEventRow,
  toGoogleBody,
  WRITABLE_ROLES,
  type EventInput,
  type GoogleEvent,
} from "@/lib/agenda/google-events";
import type { AgendaEvent } from "@/lib/agenda/view";
import { googleConfigured, googleCredentials } from "./config";
import { openToken, tokenAad, TokenCryptoError } from "./crypto";
import { accessTokenFor, forgetAccessToken, GoogleOAuthError } from "./oauth";
import { deleteEvent, getEvent, GoogleApiError, insertEvent, listCalendars, listEvents, patchEvent } from "./api";

/**
 * Agenda: leitura, sincronização e escrita. Tudo com a SESSÃO do usuário (RLS);
 * nunca com chave de serviço. O refresh token só é decifrado aqui, no servidor.
 */
type Db = Awaited<ReturnType<typeof createClient>>;
type Ctx = Awaited<ReturnType<typeof getAppContext>>;

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const REVOKED_MESSAGE = "O Google recusou o acesso (revogado ou expirado). Reconecte a conta.";
const ERROR_MESSAGE = "Não foi possível falar com o Google agora.";

export type AccountRow = {
  id: string;
  household_id: string;
  member_id: string;
  google_sub: string;
  email: string;
  status: "ok" | "revogado" | "erro";
  last_error: string | null;
  last_sync_at: string | null;
};
type AccountWithToken = AccountRow & { token_ciphertext: string };

export type CalendarDbRow = {
  id: string;
  account_ref: string;
  google_calendar_id: string;
  summary: string;
  color: string | null;
  access_role: string | null;
  selected: boolean;
  sync_token: string | null;
};

const ACCOUNT_COLS = "id, household_id, member_id, google_sub, email, status, last_error, last_sync_at";
const CAL_COLS = "id, account_ref, google_calendar_id, summary, color, access_role, selected, sync_token";

export function agendaEnabled(householdId: string) {
  return googleConfigured() && agendaAllowedFor(householdId);
}

/* ---------- Leitura ---------- */

export async function loadAccounts(db: Db, householdId: string) {
  const [{ data: accounts }, { data: calendars }] = await Promise.all([
    db.from("google_accounts").select(ACCOUNT_COLS).eq("household_id", householdId).order("created_at"),
    db.from("cal_calendars").select(CAL_COLS).eq("household_id", householdId).order("summary"),
  ]);
  return { accounts: (accounts ?? []) as AccountRow[], calendars: (calendars ?? []) as CalendarDbRow[] };
}

/** Primeira agenda do usuário onde ele escreve: a principal (id = e-mail da conta) vem antes. */
export function writableCalendarsOf(ctx: Pick<Ctx, "me">, accounts: AccountRow[], calendars: CalendarDbRow[]) {
  const mine = new Map(accounts.filter((a) => a.member_id === ctx.me?.id && a.status !== "revogado").map((a) => [a.id, a]));
  return calendars
    .filter((c) => c.selected && mine.has(c.account_ref) && WRITABLE_ROLES.has(c.access_role ?? ""))
    .map((c) => ({ ...c, primary: c.google_calendar_id === mine.get(c.account_ref)!.email }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary));
}

/** Eventos das agendas ligadas entre dois dias (inclusivo), já com dono e cor. */
export async function getEventsBetween(ctx: Ctx, from: string, to: string): Promise<AgendaEvent[]> {
  const db = await createClient();
  const hid = ctx.household.id;
  const { accounts, calendars } = await loadAccounts(db, hid);
  const selected = new Map(calendars.filter((c) => c.selected).map((c) => [c.id, c]));
  if (!selected.size) return [];
  const { data } = await db
    .from("cal_events")
    .select("id, calendar_ref, title, description, location, all_day, starts_at, ends_at, html_link, status")
    .eq("household_id", hid)
    .in("calendar_ref", [...selected.keys()])
    .lt("starts_at", spMidnightIso(addDays(to, 1)))
    .gte("ends_at", spMidnightIso(from))
    .order("starts_at")
    .limit(2000);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const memberName = new Map(ctx.members.map((m) => [m.id, m.name]));
  return (data ?? []).flatMap((e) => {
    const cal = selected.get(e.calendar_ref)!;
    const acc = accById.get(cal.account_ref);
    if (!acc) return [];
    const mine = acc.member_id === ctx.me?.id;
    return [
      {
        id: e.id,
        title: e.title,
        allDay: e.all_day,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        location: e.location,
        description: e.description,
        htmlLink: e.html_link,
        calendarId: cal.id,
        calendarName: cal.summary,
        color: cal.color,
        memberId: acc.member_id,
        owner: mine ? "Você" : (memberName.get(acc.member_id) ?? "Família"),
        editable: mine && acc.status !== "revogado" && WRITABLE_ROLES.has(cal.access_role ?? ""),
      },
    ];
  });
}

/* ---------- Token de acesso ---------- */

async function loadAccountWithToken(db: Db, householdId: string, accountId: string) {
  const { data } = await db
    .from("google_accounts")
    .select(`${ACCOUNT_COLS}, token_ciphertext`)
    .eq("household_id", householdId)
    .eq("id", accountId)
    .maybeSingle();
  return (data as AccountWithToken | null) ?? null;
}

export function decryptRefreshToken(acc: Pick<AccountWithToken, "token_ciphertext" | "household_id" | "google_sub">) {
  return openToken(acc.token_ciphertext, googleCredentials().clientSecret, tokenAad(acc.household_id, acc.google_sub));
}

class RevokedError extends Error {}

/** Token de acesso da conta. invalid_grant → status 'revogado' (eventos ficam). */
async function tokenFor(db: Db, acc: AccountWithToken) {
  try {
    return await accessTokenFor(acc.id, acc.token_ciphertext, () => decryptRefreshToken(acc));
  } catch (e) {
    if (e instanceof GoogleOAuthError && e.code === "invalid_grant") {
      forgetAccessToken(acc.id);
      await db
        .from("google_accounts")
        .update({ status: "revogado", last_error: REVOKED_MESSAGE })
        .eq("id", acc.id)
        .eq("household_id", acc.household_id);
      throw new RevokedError(REVOKED_MESSAGE);
    }
    // Chave errada (client secret trocado) também exige reconectar.
    if (e instanceof TokenCryptoError) {
      await db
        .from("google_accounts")
        .update({ status: "revogado", last_error: REVOKED_MESSAGE })
        .eq("id", acc.id)
        .eq("household_id", acc.household_id);
      throw new RevokedError(REVOKED_MESSAGE);
    }
    throw e;
  }
}

/** Roda `fn` com o token de acesso; se o Google responder 401 (token em cache derrubado), renova uma vez. */
async function withToken<T>(db: Db, acc: AccountWithToken, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await tokenFor(db, acc));
  } catch (e) {
    if (!(e instanceof GoogleApiError && e.status === 401)) throw e;
    forgetAccessToken(acc.id);
    return fn(await tokenFor(db, acc));
  }
}

/* ---------- Agendas da conta ---------- */

/** Atualiza a lista de agendas. Novas entram com selected = (owner|writer); as existentes mantêm a escolha. */
export async function refreshCalendarList(db: Db, householdId: string, accountId: string, token: string) {
  const remote = (await listCalendars(token)).map(toCalendarRow).filter((c) => c !== null);
  const { data: existing } = await db
    .from("cal_calendars")
    .select("id, google_calendar_id")
    .eq("household_id", householdId)
    .eq("account_ref", accountId);
  const known = new Map((existing ?? []).map((c) => [c.google_calendar_id, c.id]));
  const inserts = remote
    .filter((c) => !known.has(c.google_calendar_id))
    .map((c) => ({ ...c, household_id: householdId, account_ref: accountId, selected: defaultSelected(c.access_role) }));
  if (inserts.length) {
    const { error } = await db
      .from("cal_calendars")
      .upsert(inserts, { onConflict: "account_ref,google_calendar_id", ignoreDuplicates: true });
    if (error) throw new Error("Falha ao salvar agendas.");
  }
  for (const c of remote.filter((c) => known.has(c.google_calendar_id))) {
    await db
      .from("cal_calendars")
      .update({ summary: c.summary, color: c.color, access_role: c.access_role })
      .eq("id", known.get(c.google_calendar_id)!)
      .eq("household_id", householdId);
  }
  // Agendas que sumiram da conta saem (os eventos saem junto, em cascata).
  const gone = [...known.entries()].filter(([gid]) => !remote.some((c) => c.google_calendar_id === gid)).map(([, id]) => id);
  if (gone.length) await db.from("cal_calendars").delete().in("id", gone).eq("household_id", householdId);
}

/* ---------- Sincronização ---------- */

export type AgendaSyncResult =
  | { status: "skipped"; reason: "nao-liberado" | "sem-contas" | "recente" }
  | { status: "done"; upserted: number; removed: number; errors: string[] };

const CHUNK = 200;

async function syncCalendar(db: Db, householdId: string, cal: CalendarDbRow, token: string, today: string) {
  const win = syncWindow(today);
  let full = !cal.sync_token;
  let res: Awaited<ReturnType<typeof listEvents>>;
  try {
    res = full
      ? await listEvents(token, cal.google_calendar_id, { timeMin: win.min, timeMax: win.max })
      : await listEvents(token, cal.google_calendar_id, { syncToken: cal.sync_token! });
  } catch (e) {
    // 410 GONE: o syncToken venceu. A doc manda limpar e refazer a carga completa.
    if (!full && e instanceof GoogleApiError && e.status === 410) {
      full = true;
      res = await listEvents(token, cal.google_calendar_id, { timeMin: win.min, timeMax: win.max });
    } else throw e;
  }

  const plan = planEventChanges(res.items, win);
  let removed = 0;
  for (let i = 0; i < plan.upserts.length; i += CHUNK) {
    const { error } = await db.from("cal_events").upsert(
      plan.upserts.slice(i, i + CHUNK).map((r) => ({ ...r, household_id: householdId, calendar_ref: cal.id })),
      { onConflict: "calendar_ref,google_event_id" },
    );
    if (error) throw new Error("Falha ao gravar eventos.");
  }
  let deletes = plan.deletes;
  if (full) {
    // Carga completa = estado inteiro da janela; o que ficou só aqui sai.
    const { data: local } = await db
      .from("cal_events")
      .select("google_event_id")
      .eq("household_id", householdId)
      .eq("calendar_ref", cal.id)
      .limit(20000);
    deletes = [...new Set([...deletes, ...staleAfterFullSync((local ?? []).map((l) => l.google_event_id), plan.upserts.map((u) => u.google_event_id))])];
  }
  for (let i = 0; i < deletes.length; i += CHUNK) {
    const ids = deletes.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("cal_events")
      .delete()
      .eq("household_id", householdId)
      .eq("calendar_ref", cal.id)
      .in("google_event_id", ids)
      .select("id");
    if (!error) removed += data?.length ?? 0;
  }
  await db.from("cal_calendars").update({ sync_token: res.nextSyncToken }).eq("id", cal.id).eq("household_id", householdId);
  return { upserted: plan.upserts.length, removed };
}

/** Sincroniza todas as contas Google da família (Gabriel e Karen). No máximo a cada 5 min, salvo `force`. */
export async function syncFamily({ force }: { force: boolean }): Promise<AgendaSyncResult> {
  const ctx = await getAppContext();
  const hid = ctx.household.id;
  if (!agendaEnabled(hid)) return { status: "skipped", reason: "nao-liberado" };
  const db = await createClient();
  const { data: rows } = await db
    .from("google_accounts")
    .select(`${ACCOUNT_COLS}, token_ciphertext`)
    .eq("household_id", hid);
  const accounts = ((rows ?? []) as AccountWithToken[]).filter((a) => a.status !== "revogado");
  if (!accounts.length) return { status: "skipped", reason: "sem-contas" };
  if (!force && accounts.every((a) => a.last_sync_at && Date.now() - Date.parse(a.last_sync_at) < SYNC_INTERVAL_MS)) {
    return { status: "skipped", reason: "recente" };
  }

  const today = todaySP();
  let upserted = 0;
  let removed = 0;
  const errors: string[] = [];
  for (const acc of accounts) {
    let lastError: string | null = null;
    let status: AccountRow["status"] = "ok";
    try {
      if (force) await withToken(db, acc, (token) => refreshCalendarList(db, hid, acc.id, token));
      const { data: cals } = await db
        .from("cal_calendars")
        .select(CAL_COLS)
        .eq("household_id", hid)
        .eq("account_ref", acc.id)
        .eq("selected", true);
      for (const cal of (cals ?? []) as CalendarDbRow[]) {
        try {
          const r = await withToken(db, acc, (token) => syncCalendar(db, hid, cal, token, today));
          upserted += r.upserted;
          removed += r.removed;
        } catch (e) {
          if (e instanceof RevokedError) throw e;
          lastError = e instanceof GoogleApiError && e.status === 403 ? "Sem permissão para ler uma das agendas." : ERROR_MESSAGE;
          status = "erro";
        }
      }
    } catch (e) {
      if (e instanceof RevokedError) {
        errors.push(`${acc.email}: ${REVOKED_MESSAGE}`);
        continue; // status já marcado como revogado
      }
      lastError = ERROR_MESSAGE;
      status = "erro";
    }
    if (lastError) errors.push(`${acc.email}: ${lastError}`);
    await db
      .from("google_accounts")
      .update({ last_sync_at: new Date().toISOString(), last_error: lastError, status })
      .eq("id", acc.id)
      .eq("household_id", hid);
  }
  return { status: "done", upserted, removed, errors };
}

/* ---------- Escrita (duas vias) ---------- */

export type WriteResult = { ok: true; id: string } | { ok: false; erro: string };

const CONFLICT = "Este evento mudou no Google. Carreguei a versão nova; confira e tente de novo.";
const GONE = "Este evento não existe mais no Google.";

function writeError(e: unknown): string {
  if (e instanceof RevokedError) return REVOKED_MESSAGE;
  if (e instanceof GoogleApiError) {
    if (e.status === 403) return "O Google não deixou alterar esta agenda.";
    if (e.status === 400) return "O Google recusou os dados do evento.";
  }
  return ERROR_MESSAGE;
}

/** Agenda onde o usuário pode escrever: dele, ligada, owner/writer e conta ativa. */
async function ownCalendar(db: Db, ctx: Ctx, calendarId: string) {
  const { data: cal } = await db
    .from("cal_calendars")
    .select(CAL_COLS)
    .eq("household_id", ctx.household.id)
    .eq("id", calendarId)
    .maybeSingle();
  if (!cal) return null;
  const acc = await loadAccountWithToken(db, ctx.household.id, cal.account_ref);
  if (!acc || !ctx.me || acc.member_id !== ctx.me.id) return null;
  if (!WRITABLE_ROLES.has(cal.access_role ?? "")) return null;
  return { cal: cal as CalendarDbRow, acc };
}

async function saveRow(db: Db, householdId: string, calendarRef: string, ev: GoogleEvent) {
  const row = toEventRow(ev);
  if (!row) return null;
  const { data, error } = await db
    .from("cal_events")
    .upsert({ ...row, household_id: householdId, calendar_ref: calendarRef }, { onConflict: "calendar_ref,google_event_id" })
    .select("id")
    .single();
  if (error) throw new Error("Falha ao gravar o evento.");
  return data.id as string;
}

export async function createEvent(ctx: Ctx, calendarId: string, input: EventInput): Promise<WriteResult> {
  if (!agendaEnabled(ctx.household.id)) return { ok: false, erro: "Agenda não liberada para esta família." };
  const db = await createClient();
  const own = await ownCalendar(db, ctx, calendarId);
  if (!own) return { ok: false, erro: "Escolha uma das suas agendas do Google." };
  try {
    const created = await withToken(db, own.acc, (token) => insertEvent(token, own.cal.google_calendar_id, toGoogleBody(input)));
    const id = await saveRow(db, ctx.household.id, own.cal.id, created);
    return id ? { ok: true, id } : { ok: false, erro: "Resposta inesperada do Google." };
  } catch (e) {
    return { ok: false, erro: writeError(e) };
  }
}

async function ownEvent(db: Db, ctx: Ctx, eventId: string) {
  const { data: ev } = await db
    .from("cal_events")
    .select("id, calendar_ref, google_event_id, etag")
    .eq("household_id", ctx.household.id)
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return null;
  const own = await ownCalendar(db, ctx, ev.calendar_ref);
  return own ? { ev, ...own } : null;
}

/** Depois de 412/404/410: traz a versão atual do Google (ou apaga a cópia local se sumiu). */
async function reloadFromGoogle(db: Db, ctx: Ctx, token: string, cal: CalendarDbRow, googleEventId: string) {
  try {
    const fresh = await getEvent(token, cal.google_calendar_id, googleEventId);
    if (fresh.status !== "cancelled" && (await saveRow(db, ctx.household.id, cal.id, fresh))) return "conflito";
  } catch (e) {
    if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e;
  }
  await db.from("cal_events").delete().eq("household_id", ctx.household.id).eq("calendar_ref", cal.id).eq("google_event_id", googleEventId);
  return "sumiu";
}

export async function updateEvent(ctx: Ctx, eventId: string, input: EventInput): Promise<WriteResult> {
  if (!agendaEnabled(ctx.household.id)) return { ok: false, erro: "Agenda não liberada para esta família." };
  const db = await createClient();
  const own = await ownEvent(db, ctx, eventId);
  if (!own) return { ok: false, erro: "Só quem é dono da agenda pode editar este evento." };
  let token: string | null = null;
  try {
    const updated = await withToken(db, own.acc, (t) => {
      token = t;
      return patchEvent(t, own.cal.google_calendar_id, own.ev.google_event_id, toGoogleBody(input), own.ev.etag);
    });
    const id = await saveRow(db, ctx.household.id, own.cal.id, updated);
    return id ? { ok: true, id } : { ok: false, erro: "Resposta inesperada do Google." };
  } catch (e) {
    if (token && e instanceof GoogleApiError && [404, 410, 412].includes(e.status)) {
      const r = await reloadFromGoogle(db, ctx, token, own.cal, own.ev.google_event_id).catch(() => null);
      return { ok: false, erro: r === "sumiu" ? GONE : CONFLICT };
    }
    return { ok: false, erro: writeError(e) };
  }
}

export async function removeEvent(ctx: Ctx, eventId: string): Promise<WriteResult> {
  if (!agendaEnabled(ctx.household.id)) return { ok: false, erro: "Agenda não liberada para esta família." };
  const db = await createClient();
  const own = await ownEvent(db, ctx, eventId);
  if (!own) return { ok: false, erro: "Só quem é dono da agenda pode apagar este evento." };
  let token: string | null = null;
  try {
    await withToken(db, own.acc, (t) => {
      token = t;
      return deleteEvent(t, own.cal.google_calendar_id, own.ev.google_event_id, own.ev.etag);
    });
  } catch (e) {
    const gone = e instanceof GoogleApiError && (e.status === 404 || e.status === 410);
    if (token && e instanceof GoogleApiError && e.status === 412) {
      const r = await reloadFromGoogle(db, ctx, token, own.cal, own.ev.google_event_id).catch(() => null);
      if (r !== "sumiu") return { ok: false, erro: CONFLICT };
    } else if (!gone) {
      return { ok: false, erro: writeError(e) };
    }
  }
  await db.from("cal_events").delete().eq("household_id", ctx.household.id).eq("id", own.ev.id);
  return { ok: true, id: own.ev.id };
}
