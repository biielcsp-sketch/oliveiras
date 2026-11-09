/**
 * Validação de entrada de Saúde (carteirinhas, consultas, exames). Roda no servidor; no navegador só ajuda.
 * household_id nunca vem do formulário: as actions usam getAppContext().
 */
import { isDate, normalizeLocal, spLocalToMs } from "@/lib/agenda/dates";
import type { AppointmentKind, AppointmentStatus } from "./types";

export const LIMITS = {
  operator: 120,
  cardNumber: 60,
  plan: 120,
  cardNotes: 500,
  specialty: 120,
  doctor: 120,
  place: 200,
  apptNotes: 1000,
  examName: 160,
  lab: 120,
  requestedBy: 120,
  summary: 2000,
} as const;

type Fail = { ok: false; erro: string };
type Ok<T> = { ok: true; value: T };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");
const oneLine = (v: unknown) => clean(v).replace(/\s+/g, " ");
const orNull = (s: string) => s || null;

function tooLong(label: string, s: string, max: number): Fail | null {
  return s.length > max ? { ok: false, erro: `${label} muito longo (máximo ${max}).` } : null;
}

function member(raw: unknown, memberIds: string[]): string | Fail {
  const id = clean(raw);
  if (!UUID.test(id) || !memberIds.includes(id)) return { ok: false, erro: "Escolha a pessoa." };
  return id;
}

/* ---------- Carteirinha ---------- */

export type CardInput = {
  member_id: string;
  operator: string;
  card_number: string | null;
  plan_name: string | null;
  valid_until: string | null;
  notes: string | null;
};

export function validateCardInput(raw: Record<string, unknown>, memberIds: string[]): Ok<CardInput> | Fail {
  const m = member(raw.member_id, memberIds);
  if (typeof m !== "string") return m;
  const operator = oneLine(raw.operator);
  if (!operator) return { ok: false, erro: "Informe a operadora." };
  const number = oneLine(raw.card_number);
  const plan = oneLine(raw.plan_name);
  const notes = clean(raw.notes);
  const validUntil = clean(raw.valid_until);
  const err =
    tooLong("Operadora", operator, LIMITS.operator) ??
    tooLong("Número", number, LIMITS.cardNumber) ??
    tooLong("Plano", plan, LIMITS.plan) ??
    tooLong("Observações", notes, LIMITS.cardNotes);
  if (err) return err;
  if (validUntil && !isDate(validUntil)) return { ok: false, erro: "Validade inválida." };
  return { ok: true, value: { member_id: m, operator, card_number: orNull(number), plan_name: orNull(plan), valid_until: orNull(validUntil), notes: orNull(notes) } };
}

export const cardInputFromForm = (f: FormData) => ({
  member_id: f.get("member_id"),
  operator: f.get("operator"),
  card_number: f.get("card_number"),
  plan_name: f.get("plan_name"),
  valid_until: f.get("valid_until"),
  notes: f.get("notes"),
});

/* ---------- Consulta / retorno ---------- */

export const KINDS: AppointmentKind[] = ["consulta", "retorno"];
export const STATUSES: AppointmentStatus[] = ["agendada", "realizada", "cancelada"];
export const STATUS_LABEL: Record<AppointmentStatus, string> = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada" };
export const KIND_LABEL: Record<AppointmentKind, string> = { consulta: "Consulta", retorno: "Retorno" };

export type AppointmentInput = {
  member_id: string;
  kind: AppointmentKind;
  specialty: string | null;
  doctor: string | null;
  place: string | null;
  /** ISO (timestamptz); o formulário manda horário de São Paulo. */
  starts_at: string;
  status: AppointmentStatus;
  notes: string | null;
  return_of: string | null;
};

export function validateAppointmentInput(raw: Record<string, unknown>, memberIds: string[]): Ok<AppointmentInput> | Fail {
  const m = member(raw.member_id, memberIds);
  if (typeof m !== "string") return m;
  const kind = clean(raw.kind) as AppointmentKind;
  if (!KINDS.includes(kind)) return { ok: false, erro: "Tipo inválido." };
  const status = (clean(raw.status) || "agendada") as AppointmentStatus;
  if (!STATUSES.includes(status)) return { ok: false, erro: "Situação inválida." };
  const local = normalizeLocal(clean(raw.starts_at));
  if (!local) return { ok: false, erro: "Informe a data e a hora." };
  const specialty = oneLine(raw.specialty);
  const doctor = oneLine(raw.doctor);
  const place = oneLine(raw.place);
  const notes = clean(raw.notes);
  const err =
    tooLong("Especialidade", specialty, LIMITS.specialty) ??
    tooLong("Médico", doctor, LIMITS.doctor) ??
    tooLong("Local", place, LIMITS.place) ??
    tooLong("Observações", notes, LIMITS.apptNotes);
  if (err) return err;
  let returnOf: string | null = null;
  if (kind === "retorno") {
    const r = clean(raw.return_of);
    if (r) {
      if (!UUID.test(r)) return { ok: false, erro: "Consulta de origem inválida." };
      returnOf = r;
    }
  }
  return {
    ok: true,
    value: {
      member_id: m,
      kind,
      specialty: orNull(specialty),
      doctor: orNull(doctor),
      place: orNull(place),
      starts_at: new Date(spLocalToMs(local)).toISOString(),
      status,
      notes: orNull(notes),
      return_of: returnOf,
    },
  };
}

export const appointmentInputFromForm = (f: FormData) => ({
  member_id: f.get("member_id"),
  kind: f.get("kind"),
  specialty: f.get("specialty"),
  doctor: f.get("doctor"),
  place: f.get("place"),
  starts_at: f.get("starts_at"),
  status: f.get("status"),
  notes: f.get("notes"),
  return_of: f.get("return_of"),
});

/* ---------- Exame ---------- */

export type ExamInput = {
  member_id: string;
  name: string;
  exam_date: string | null;
  lab: string | null;
  requested_by: string | null;
  result_summary: string | null;
};

export function validateExamInput(raw: Record<string, unknown>, memberIds: string[]): Ok<ExamInput> | Fail {
  const m = member(raw.member_id, memberIds);
  if (typeof m !== "string") return m;
  const name = oneLine(raw.name);
  if (!name) return { ok: false, erro: "Informe o nome do exame." };
  const lab = oneLine(raw.lab);
  const requestedBy = oneLine(raw.requested_by);
  const summary = clean(raw.result_summary);
  const date = clean(raw.exam_date);
  const err =
    tooLong("Nome", name, LIMITS.examName) ??
    tooLong("Laboratório", lab, LIMITS.lab) ??
    tooLong("Pedido por", requestedBy, LIMITS.requestedBy) ??
    tooLong("Resumo", summary, LIMITS.summary);
  if (err) return err;
  if (date && !isDate(date)) return { ok: false, erro: "Data inválida." };
  return { ok: true, value: { member_id: m, name, exam_date: orNull(date), lab: orNull(lab), requested_by: orNull(requestedBy), result_summary: orNull(summary) } };
}

export const examInputFromForm = (f: FormData) => ({
  member_id: f.get("member_id"),
  name: f.get("name"),
  exam_date: f.get("exam_date"),
  lab: f.get("lab"),
  requested_by: f.get("requested_by"),
  result_summary: f.get("result_summary"),
});
