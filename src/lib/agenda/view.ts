/**
 * Montagem da Agenda para a tela, o calendário do topo e o Oli. Funções puras.
 */
import { addDays, shortDayLabel, toSpDate, toSpLocal, toSpTime } from "./dates";

/** Evento pronto para a tela (sem dados sensíveis da conta). */
export type AgendaEvent = {
  id: string;
  title: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  location: string | null;
  description: string | null;
  htmlLink: string | null;
  calendarId: string;
  calendarName: string;
  color: string | null;
  memberId: string;
  /** "Você" ou o nome do membro dono da conta Google. */
  owner: string;
  /** Só o dono da conta edita, e só em agendas owner/writer. */
  editable: boolean;
};

export const untitled = (t: string) => t.trim() || "(Sem título)";

/** Cor só se for hexadecimal (#rrggbb); qualquer outra coisa usa a cor neutra do tema. */
export function safeHex(c: string | null | undefined) {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : "var(--muted)";
}

const MAX_SPAN = 62;

/** Dias (São Paulo) que o evento ocupa. Fim exclusivo; evento de duração zero ocupa o dia do início. */
export function eventDays(e: Pick<AgendaEvent, "startsAt" | "endsAt" | "allDay">): string[] {
  const first = toSpDate(e.startsAt);
  const endMs = Date.parse(e.endsAt);
  const last = endMs > Date.parse(e.startsAt) ? toSpDate(endMs - 1) : first;
  const days = [first];
  for (let d = first; d < last && days.length < MAX_SPAN; ) {
    d = addDays(d, 1);
    days.push(d);
  }
  return days;
}

/** "Dia inteiro" | "19:00 – 21:00" | "19:00" (sem duração) | início/fim em outro dia com a data. */
export function timeLabel(e: Pick<AgendaEvent, "startsAt" | "endsAt" | "allDay">, day?: string) {
  if (e.allDay) return "Dia inteiro";
  const s = toSpLocal(e.startsAt);
  const f = toSpLocal(e.endsAt);
  const fmt = (local: string) => (day && local.slice(0, 10) !== day ? `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11)}` : local.slice(11));
  if (s === f) return fmt(s);
  return `${fmt(s)} – ${fmt(f)}`;
}

const sortKey = (e: AgendaEvent) => `${e.allDay ? "0" : "1"}${e.startsAt}${e.title}`;

/** Agrupa por dia dentro de [from, to] (inclusivo), na ordem dos dias; dia inteiro primeiro. */
export function groupByDay(events: AgendaEvent[], from: string, to: string) {
  const map = new Map<string, AgendaEvent[]>();
  for (let d = from; d <= to; d = addDays(d, 1)) map.set(d, []);
  for (const e of events) for (const d of eventDays(e)) map.get(d)?.push(e);
  return [...map.entries()].map(([day, list]) => ({ day, events: list.sort((a, b) => sortKey(a).localeCompare(sortKey(b))) }));
}

/** Dias com evento num conjunto (pontinhos do calendário), com as cores (até 3 por dia). */
export function dotsByDay(events: AgendaEvent[]) {
  const out: Record<string, string[]> = {};
  for (const e of [...events].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    for (const d of eventDays(e)) {
      const list = (out[d] ??= []);
      const c = safeHex(e.color);
      if (list.length < 3 && !list.includes(c)) list.push(c);
    }
  }
  return out;
}

/** Valores para o formulário de edição (dia inteiro: fim inclusivo). */
export function formValues(e: AgendaEvent) {
  if (e.allDay) {
    const endExclusive = toSpDate(e.endsAt);
    const start = toSpDate(e.startsAt);
    const end = endExclusive > start ? addDays(endExclusive, -1) : start;
    return { start, end };
  }
  return { start: toSpLocal(e.startsAt), end: toSpLocal(e.endsAt) };
}

/** "seg., 9 de nov. · 19:00 – 21:00" ou "seg., 9 de nov. a qua., 11 de nov. · Dia inteiro". */
export function whenLabel(e: Pick<AgendaEvent, "startsAt" | "endsAt" | "allDay">) {
  if (e.allDay) {
    const { start, end } = formValues(e as AgendaEvent);
    return `${shortDayLabel(start)}${end !== start ? ` a ${shortDayLabel(end)}` : ""} · Dia inteiro`;
  }
  const day = toSpDate(e.startsAt);
  return `${shortDayLabel(day)} · ${timeLabel(e, day)}`;
}

export { toSpTime };
