/**
 * Validação de evento (formulário da Agenda e Oli). Mesmas regras e mensagens nos dois caminhos.
 * Roda no servidor antes de chamar o Google; no navegador só ajuda o preenchimento.
 */
import { addDays, isDate, normalizeLocal, spLocalToMs, toSpLocal } from "./dates";
import type { EventInput } from "./google-events";

export const EVENT_LIMITS = { title: 300, location: 300, description: 2000 } as const;
/** Evento com horário pode durar até 1 ano; dia inteiro também (evita digitação errada de ano). */
const MAX_SPAN_DAYS = 366;

export type RawEventInput = {
  title?: unknown;
  allDay?: unknown;
  start?: unknown;
  end?: unknown;
  location?: unknown;
  description?: unknown;
};

type Ok = { ok: true; value: EventInput };
type Fail = { ok: false; erro: string };

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

export function validateEventInput(raw: RawEventInput): Ok | Fail {
  const title = text(raw.title).replace(/\s+/g, " ");
  if (!title) return { ok: false, erro: "Dê um título ao evento." };
  if (title.length > EVENT_LIMITS.title) return { ok: false, erro: `Título muito longo (máximo ${EVENT_LIMITS.title}).` };

  const location = text(raw.location).replace(/\s+/g, " ");
  if (location.length > EVENT_LIMITS.location) return { ok: false, erro: `Local muito longo (máximo ${EVENT_LIMITS.location}).` };
  const description = text(raw.description);
  if (description.length > EVENT_LIMITS.description)
    return { ok: false, erro: `Descrição muito longa (máximo ${EVENT_LIMITS.description}).` };

  const allDay = raw.allDay === true || raw.allDay === "on" || raw.allDay === "true";
  let start: string;
  let end: string;
  if (allDay) {
    const s = text(raw.start).slice(0, 10);
    const e = text(raw.end).slice(0, 10) || s;
    if (!isDate(s)) return { ok: false, erro: "Data de início inválida." };
    if (!isDate(e)) return { ok: false, erro: "Data de fim inválida." };
    if (e < s) return { ok: false, erro: "O fim não pode ser antes do início." };
    if (addDays(s, MAX_SPAN_DAYS) < e) return { ok: false, erro: "Evento longo demais (máximo 1 ano)." };
    start = s;
    end = e;
  } else {
    const s = normalizeLocal(text(raw.start));
    if (!s) return { ok: false, erro: "Início inválido." };
    const rawEnd = text(raw.end);
    // Sem fim: 1 hora de duração.
    const e = rawEnd ? normalizeLocal(rawEnd) : toSpLocal(spLocalToMs(s) + 3_600_000);
    if (!e) return { ok: false, erro: "Fim inválido." };
    const sMs = spLocalToMs(s);
    const eMs = spLocalToMs(e);
    if (eMs < sMs) return { ok: false, erro: "O fim não pode ser antes do início." };
    if (eMs - sMs > MAX_SPAN_DAYS * 86_400_000) return { ok: false, erro: "Evento longo demais (máximo 1 ano)." };
    start = s;
    end = e;
  }
  return { ok: true, value: { title, allDay, start, end, location: location || null, description: description || null } };
}

/** Formulário (FormData) → entrada crua. */
export function eventInputFromForm(form: FormData): RawEventInput {
  const g = (k: string) => form.get(k);
  const allDay = g("all_day") === "on";
  return {
    title: g("title"),
    allDay,
    start: allDay ? g("start_date") : g("start"),
    end: allDay ? g("end_date") : g("end"),
    location: g("location"),
    description: g("description"),
  };
}
