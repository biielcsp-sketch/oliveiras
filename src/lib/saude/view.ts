import { brDate, toSpDate, toSpTime } from "@/lib/agenda/dates";
import type { HealthAppointment } from "./types";

/** Próximas = agendadas daqui para frente (mais cedo primeiro). Passadas = o resto (mais recente primeiro). */
export function splitAppointments(list: HealthAppointment[], nowMs: number = Date.now()) {
  const upcoming = list.filter((a) => a.status === "agendada" && Date.parse(a.starts_at) >= nowMs);
  const ids = new Set(upcoming.map((a) => a.id));
  const past = list.filter((a) => !ids.has(a.id));
  upcoming.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  past.sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return { upcoming, past };
}

export const whenLabel = (iso: string) => `${brDate(toSpDate(iso))} às ${toSpTime(iso)}`;

/** Valor do <input type="datetime-local"> (horário de São Paulo). */
export const toInputLocal = (iso: string) => `${toSpDate(iso)}T${toSpTime(iso)}`;
