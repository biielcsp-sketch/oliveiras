/**
 * Datas da Casa (tarefas com rodízio e manutenções). Funções puras sobre "AAAA-MM-DD" (dia de São Paulo):
 * contas em UTC sobre a data civil, sem passar por horário, para nunca deslocar o dia.
 * Dia da semana: 0 = domingo … 6 = sábado.
 */
import { addDays } from "@/lib/agenda/dates";
import type { Frequency, IntervalUnit } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const split = (date: string) => date.split("-").map(Number) as [number, number, number];

export function weekdayOf(date: string) {
  const [y, m, d] = split(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Dias do mês (m de 1 a 12). */
export function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Dia `day` do mês, ajustado para o último dia em meses curtos (31 → 30 ou 28/29). */
function clampedDay(y: number, m: number, day: number) {
  return ymd(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Soma meses mantendo o dia; em mês curto cai no último dia (31/01 + 1 mês = 28/02). */
export function addMonths(date: string, n: number) {
  const [y, m, d] = split(date);
  const idx = y * 12 + (m - 1) + n;
  return clampedDay(Math.floor(idx / 12), (idx % 12) + 1, d);
}

export type ChoreSchedule = { frequency: Frequency; weekdays: number[] | null; month_day: number | null };

/** Primeira data da tarefa no dia `from` ou depois. */
export function firstDueOn(s: ChoreSchedule, from: string): string {
  if (s.frequency === "diaria") return from;
  if (s.frequency === "semanal") {
    const days = new Set(s.weekdays ?? []);
    if (days.size === 0) return from;
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      if (days.has(weekdayOf(d))) return d;
    }
    return from;
  }
  const [y, m] = split(from);
  const day = s.month_day ?? 1;
  const here = clampedDay(y, m, day);
  if (here >= from) return here;
  return clampedDay(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, day);
}

/** Próxima data estritamente depois de `after` (diária: dia seguinte; semanal: próximo dia marcado; mensal: mês seguinte). */
export const nextDueAfter = (s: ChoreSchedule, after: string) => firstDueOn(s, addDays(after, 1));

/** Próximo índice do rodízio (circular). */
export const nextRotationIndex = (index: number, size: number) => (size <= 0 ? 0 : (index + 1) % size);

type Rotation = { rotation: string[]; next_index: number };

/**
 * Primeira posição do rodízio, a partir de `start` (circular), cujo id ainda é member da família.
 * Um member apagado continua no array (o banco só revalida quando o rodízio muda): é pulado. -1 se nenhum vale.
 */
export function validIndexFrom(rotation: string[], start: number, valid: ReadonlySet<string>) {
  const n = rotation.length;
  for (let i = 0; i < n; i++) {
    const idx = (((start + i) % n) + n) % n;
    if (valid.has(rotation[idx])) return idx;
  }
  return -1;
}

/** Responsável da vez (member id válido) ou null se o rodízio estiver vazio ou sem ninguém da família. */
export function currentResponsible(c: Rotation, valid: ReadonlySet<string>) {
  const i = validIndexFrom(c.rotation, c.next_index, valid);
  return i < 0 ? null : c.rotation[i];
}

/** Índice depois do responsável da vez, já parando no próximo member válido ("Feita" e "pular a vez"). */
export function advanceRotation(c: Rotation, valid: ReadonlySet<string>) {
  const n = c.rotation.length;
  if (n === 0) return 0;
  const cur = validIndexFrom(c.rotation, c.next_index, valid);
  if (cur < 0) return nextRotationIndex(Math.min(c.next_index, n - 1), n);
  const next = validIndexFrom(c.rotation, cur + 1, valid);
  return next < 0 ? nextRotationIndex(cur, n) : next;
}

/** Rodízio só com quem ainda é da família (usado ao editar a tarefa). */
export const cleanRotation = (rotation: string[], valid: ReadonlySet<string>) => rotation.filter((id) => valid.has(id));

/**
 * "Feita": registra o responsável da vez, avança o rodízio e calcula a próxima data.
 * A base é a data prevista ou hoje, a que for maior: tarefa atrasada feita hoje volta para o próximo dia
 * depois de hoje (não fica "atrasada" de novo); feita antes da hora, segue a partir da data prevista.
 */
export function completeChore(
  c: ChoreSchedule & Rotation & { next_due_on: string | null },
  today: string,
  valid: ReadonlySet<string>,
) {
  const due = c.next_due_on ?? today;
  const base = due > today ? due : today;
  return {
    member_id: currentResponsible(c, valid),
    done_on: today,
    next_index: advanceRotation(c, valid),
    next_due_on: nextDueAfter(c, base),
  };
}

/** Próxima manutenção: última vez + intervalo (meses/anos ajustam para o último dia do mês). */
export function nextMaintenanceDue(lastDoneOn: string | null, value: number, unit: IntervalUnit): string | null {
  if (!lastDoneOn) return null;
  switch (unit) {
    case "dias":
      return addDays(lastDoneOn, value);
    case "semanas":
      return addDays(lastDoneOn, value * 7);
    case "meses":
      return addMonths(lastDoneOn, value);
    case "anos":
      return addMonths(lastDoneOn, value * 12);
  }
}
