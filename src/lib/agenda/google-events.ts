/**
 * Eventos do Google Calendar ↔ linhas de cal_events. Funções puras.
 * Formato do recurso Event (API v3): start/end têm `date` (dia inteiro, fim exclusivo)
 * ou `dateTime` (RFC 3339 com offset). Cancelados chegam com status "cancelled".
 */
import { addDays, spLocalToRfc3339, spMidnightIso, TZ } from "./dates";

export type GoogleEventTime = { date?: string | null; dateTime?: string | null; timeZone?: string | null };
export type GoogleEvent = {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: GoogleEventTime | null;
  end?: GoogleEventTime | null;
  recurringEventId?: string | null;
  htmlLink?: string | null;
  updated?: string | null;
};

export type GoogleCalendarListEntry = {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
};

export type EventRow = {
  google_event_id: string;
  etag: string | null;
  status: "confirmed" | "tentative";
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  recurring_event_id: string | null;
  html_link: string | null;
  google_updated_at: string | null;
};

/* Limites das colunas (0007_agenda.sql). */
const MAX = { id: 1024, etag: 300, title: 1024, description: 8192, location: 1024, link: 2048 } as const;

const cut = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);

/** Só links https do próprio Google viram "Abrir no Google". */
export function safeGoogleLink(v: unknown) {
  if (typeof v !== "string" || v.length > MAX.link) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (u.hostname === "www.google.com" || u.hostname === "calendar.google.com") ? u.toString() : null;
  } catch {
    return null;
  }
}

const isoOrNull = (v: unknown) => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Instante de início/fim: `date` → meia-noite de São Paulo; `dateTime` → o offset informado. */
export function eventTimeToIso(t: GoogleEventTime | null | undefined): { iso: string; allDay: boolean } | null {
  if (!t) return null;
  if (typeof t.date === "string" && DATE_ONLY.test(t.date)) return { iso: spMidnightIso(t.date), allDay: true };
  const iso = isoOrNull(t.dateTime);
  return iso ? { iso, allDay: false } : null;
}

/** Evento do Google → linha (sem household/calendar). Cancelado ou sem datas → null. */
export function toEventRow(e: GoogleEvent): EventRow | null {
  if (!e.id || typeof e.id !== "string" || e.id.length > MAX.id) return null;
  if (e.status === "cancelled") return null;
  const start = eventTimeToIso(e.start);
  if (!start) return null;
  const end = eventTimeToIso(e.end);
  let endsAt = end?.iso ?? (start.allDay ? spMidnightIso(addDays(e.start!.date!, 1)) : start.iso);
  if (Date.parse(endsAt) < Date.parse(start.iso)) endsAt = start.iso;
  return {
    google_event_id: e.id,
    etag: cut(e.etag, MAX.etag),
    status: e.status === "tentative" ? "tentative" : "confirmed",
    title: cut(e.summary, MAX.title) ?? "",
    description: cut(e.description, MAX.description),
    location: cut(e.location, MAX.location),
    all_day: start.allDay,
    starts_at: start.iso,
    ends_at: endsAt,
    recurring_event_id: cut(e.recurringEventId, MAX.id),
    html_link: safeGoogleLink(e.htmlLink),
    google_updated_at: isoOrNull(e.updated),
  };
}

export type SyncWindow = { min: string; max: string }; // instantes ISO

/** Janela da sincronização completa: hoje − 60 dias até hoje + 365 dias (meia-noite de São Paulo). */
export function syncWindow(today: string): SyncWindow {
  return { min: spMidnightIso(addDays(today, -60)), max: spMidnightIso(addDays(today, 365)) };
}

/**
 * Plano de uma leva de eventos vindos do Google.
 * Cancelado → apaga; fora da janela → apaga (não guardamos o que a sincronização completa não traria);
 * o resto → upsert por (calendar_ref, google_event_id). Repetições do mesmo id: vale a última.
 */
export function planEventChanges(items: GoogleEvent[], window: SyncWindow) {
  const upserts = new Map<string, EventRow>();
  const deletes = new Set<string>();
  const min = Date.parse(window.min);
  const max = Date.parse(window.max);
  for (const e of items) {
    if (!e?.id || typeof e.id !== "string") continue;
    const row = toEventRow(e);
    const outside = row && (Date.parse(row.ends_at) < min || Date.parse(row.starts_at) > max);
    if (!row || outside) {
      upserts.delete(e.id);
      deletes.add(e.id);
    } else {
      deletes.delete(e.id);
      upserts.set(e.id, row);
    }
  }
  return { upserts: [...upserts.values()], deletes: [...deletes] };
}

/** Na sincronização completa, o que existe localmente e não veio do Google sai. */
export function staleAfterFullSync(localIds: string[], fetchedIds: Iterable<string>) {
  const keep = new Set(fetchedIds);
  return localIds.filter((id) => !keep.has(id));
}

/* ---------- Agendas ---------- */

export type CalendarRow = {
  google_calendar_id: string;
  summary: string;
  color: string | null;
  access_role: "owner" | "writer" | "reader" | "freeBusyReader" | null;
};

const ROLES = new Set(["owner", "writer", "reader", "freeBusyReader"]);
export const WRITABLE_ROLES = new Set(["owner", "writer"]);

export function toCalendarRow(c: GoogleCalendarListEntry): CalendarRow | null {
  if (!c.id || typeof c.id !== "string" || c.id.length > MAX.id) return null;
  const summary = (c.summaryOverride || c.summary || c.id).slice(0, 300);
  const color = typeof c.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(c.backgroundColor) ? c.backgroundColor.toLowerCase() : null;
  const access_role = ROLES.has(c.accessRole ?? "") ? (c.accessRole as CalendarRow["access_role"]) : null;
  return { google_calendar_id: c.id, summary, color, access_role };
}

/** Ao conectar: só agendas em que a pessoa escreve começam ligadas (feriados, agendas de outros etc. desligadas). */
export const defaultSelected = (role: string | null) => WRITABLE_ROLES.has(role ?? "");

/* ---------- Escrita (app → Google) ---------- */

export type EventInput = {
  title: string;
  allDay: boolean;
  /** Dia inteiro: "AAAA-MM-DD" (fim INCLUSIVO, como a pessoa digita). Com horário: "AAAA-MM-DDTHH:mm" em São Paulo. */
  start: string;
  end: string;
  location: string | null;
  description: string | null;
  /** Opcional: lembretes popup, em minutos antes do início (substituem os padrões da agenda). Ausente = não mexe nos lembretes. */
  reminders?: number[];
};

/** Limites da API (events.reminders.overrides): minutos 0..40320 (4 semanas), no máximo 5 lembretes. */
export const REMINDER_MAX_MINUTES = 40320;
export const REMINDER_MAX_COUNT = 5;

export function validReminders(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length <= REMINDER_MAX_COUNT &&
    v.every((m) => Number.isInteger(m) && m >= 0 && m <= REMINDER_MAX_MINUTES) &&
    new Set(v).size === v.length
  );
}

/**
 * Corpo para events.insert/patch. No patch, `null` apaga o campo do outro formato
 * (trocar dia inteiro ↔ horário não pode deixar `date` e `dateTime` juntos).
 */
export function toGoogleBody(input: EventInput) {
  const time = (v: string, exclusiveEnd: boolean) =>
    input.allDay
      ? { date: exclusiveEnd ? addDays(v, 1) : v, dateTime: null, timeZone: null }
      : { date: null, dateTime: spLocalToRfc3339(v), timeZone: TZ };
  if (input.reminders !== undefined && !validReminders(input.reminders)) throw new Error("Lembretes inválidos.");
  return {
    summary: input.title,
    location: input.location ?? "",
    description: input.description ?? "",
    start: time(input.start, false),
    end: time(input.end, true),
    // Só quando informado: sem o campo o corpo é o de sempre (no PATCH, o Google mantém os lembretes do evento).
    ...(input.reminders
      ? { reminders: { useDefault: false, overrides: input.reminders.map((minutes) => ({ method: "popup" as const, minutes })) } }
      : {}),
  };
}
