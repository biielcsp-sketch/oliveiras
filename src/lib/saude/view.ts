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

type Dated = { member_id: string };

/** Vacinas: próxima dose mais cedo primeiro entre as que têm data; depois as sem data, por aplicação mais recente. */
export function sortVaccines<T extends { next_dose_on: string | null; applied_on: string | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.next_dose_on && b.next_dose_on) return a.next_dose_on.localeCompare(b.next_dose_on);
    if (a.next_dose_on) return -1;
    if (b.next_dose_on) return 1;
    return (b.applied_on ?? "").localeCompare(a.applied_on ?? "");
  });
}

/** Procedimentos: mais recentes primeiro; sem data por último. */
export function sortProcedures<T extends { performed_on: string | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.performed_on ?? "").localeCompare(a.performed_on ?? ""));
}

/** Medicamentos separados em "em uso" e "encerrados". */
export function splitMedications<T extends { active: boolean }>(list: T[]) {
  return { active: list.filter((m) => m.active), ended: list.filter((m) => !m.active) };
}

/** Próxima dose atrasada: data anterior a hoje (YYYY-MM-DD, horário de São Paulo). */
export const isOverdue = (date: string | null, today: string) => !!date && date < today;

/** Filtro por pessoa; "" = todos. */
export function filterByMember<T extends Dated>(list: T[], memberId: string): T[] {
  return memberId ? list.filter((x) => x.member_id === memberId) : list;
}
