/** Tipos à mão das tabelas de Saúde (0010_saude.sql e 0011); os tipos do Supabase ainda não são gerados. */
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

export type HealthProcedure = {
  id: string;
  member_id: string;
  name: string;
  performed_on: string | null;
  place: string | null;
  doctor: string | null;
  notes: string | null;
  file_path: string | null;
  file_mime: FileMime | null;
  file_size: number | null;
};

export type HealthMedication = {
  id: string;
  member_id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  started_on: string | null;
  ended_on: string | null;
  active: boolean;
  prescribed_by: string | null;
  notes: string | null;
};

export type HealthVaccine = {
  id: string;
  member_id: string;
  name: string;
  dose_label: string | null;
  applied_on: string | null;
  next_dose_on: string | null;
  place: string | null;
  lot: string | null;
  notes: string | null;
  file_path: string | null;
  file_mime: FileMime | null;
  file_size: number | null;
};

export const PROCEDURE_COLS = "id, member_id, name, performed_on, place, doctor, notes, file_path, file_mime, file_size";
export const MEDICATION_COLS = "id, member_id, name, dosage, frequency, started_on, ended_on, active, prescribed_by, notes";
export const VACCINE_COLS = "id, member_id, name, dose_label, applied_on, next_dose_on, place, lot, notes, file_path, file_mime, file_size";
