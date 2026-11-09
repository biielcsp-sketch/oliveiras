/** Tipos à mão das tabelas de Saúde (0010_saude.sql); os tipos do Supabase ainda não são gerados. */
export type FileMime = "application/pdf" | "image/jpeg";
export type AppointmentKind = "consulta" | "retorno";
export type AppointmentStatus = "agendada" | "realizada" | "cancelada";

export type HealthCard = {
  id: string;
  member_id: string;
  operator: string;
  card_number: string | null;
  plan_name: string | null;
  valid_until: string | null;
  notes: string | null;
  file_path: string;
  file_mime: FileMime;
  file_size: number;
  updated_at: string;
};

export type HealthAppointment = {
  id: string;
  member_id: string;
  kind: AppointmentKind;
  specialty: string | null;
  doctor: string | null;
  place: string | null;
  starts_at: string;
  status: AppointmentStatus;
  notes: string | null;
  return_of: string | null;
  agenda_event_id: string | null;
};

export type HealthExam = {
  id: string;
  member_id: string;
  name: string;
  exam_date: string | null;
  lab: string | null;
  requested_by: string | null;
  result_summary: string | null;
  file_path: string | null;
  file_mime: FileMime | null;
  file_size: number | null;
};

export const CARD_COLS = "id, member_id, operator, card_number, plan_name, valid_until, notes, file_path, file_mime, file_size, updated_at";
export const APPOINTMENT_COLS = "id, member_id, kind, specialty, doctor, place, starts_at, status, notes, return_of, agenda_event_id";
export const EXAM_COLS = "id, member_id, name, exam_date, lab, requested_by, result_summary, file_path, file_mime, file_size";
