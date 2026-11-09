import "server-only";
import { googleEndpoints } from "./config";
import type { GoogleCalendarListEntry, GoogleEvent } from "@/lib/agenda/google-events";

/** Chamadas à Google Calendar API v3 (sempre do servidor). */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MAX_PAGES = 40;
const PAGE_SIZE = 250;

async function call<T>(token: string, method: string, path: string, opts: { body?: unknown; ifMatch?: string | null } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
  const res = await fetch(`${googleEndpoints().api}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (res.status === 204) return null as T;
  if (!res.ok) throw new GoogleApiError(`Google Calendar respondeu ${res.status}.`, res.status);
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export async function listCalendars(token: string) {
  const all: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    const data = await call<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(token, "GET", `/users/me/calendarList?${q}`);
    all.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) return all;
  }
  throw new GoogleApiError("Muitas páginas de agendas.", 500);
}

/**
 * events.list completo ou incremental. Com syncToken NÃO mandamos timeMin/timeMax
 * (incompatíveis, segundo a doc); os demais parâmetros repetem os da carga completa.
 * Token vencido → o Google responde 410 (GoogleApiError.status), e quem chama refaz a carga completa.
 */
export async function listEvents(
  token: string,
  calendarId: string,
  mode: { syncToken: string } | { timeMin: string; timeMax: string },
) {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ singleEvents: "true", maxResults: String(PAGE_SIZE) });
    if ("syncToken" in mode) q.set("syncToken", mode.syncToken);
    else {
      q.set("timeMin", mode.timeMin);
      q.set("timeMax", mode.timeMax);
    }
    if (pageToken) q.set("pageToken", pageToken);
    const data = await call<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
      token,
      "GET",
      `/calendars/${enc(calendarId)}/events?${q}`,
    );
    items.push(...(data.items ?? []));
    if (!data.nextPageToken) return { items, nextSyncToken: data.nextSyncToken ?? null };
    pageToken = data.nextPageToken;
  }
  throw new GoogleApiError("Muitas páginas de eventos.", 500);
}

export const getEvent = (token: string, calendarId: string, eventId: string) =>
  call<GoogleEvent>(token, "GET", `/calendars/${enc(calendarId)}/events/${enc(eventId)}`);

export const insertEvent = (token: string, calendarId: string, body: unknown) =>
  call<GoogleEvent>(token, "POST", `/calendars/${enc(calendarId)}/events`, { body });

/** PATCH com If-Match: se o evento mudou no Google, 412. */
export const patchEvent = (token: string, calendarId: string, eventId: string, body: unknown, etag: string | null) =>
  call<GoogleEvent>(token, "PATCH", `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, { body, ifMatch: etag });

/** DELETE com If-Match. 410 = já apagado. */
export const deleteEvent = (token: string, calendarId: string, eventId: string, etag: string | null) =>
  call<null>(token, "DELETE", `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, { ifMatch: etag });
