/** Tipos à mão das tabelas da Casa (0015_casa_parte_1.sql); os tipos do Supabase ainda não são gerados. */
export type Frequency = "diaria" | "semanal" | "mensal";
export type IntervalUnit = "dias" | "semanas" | "meses" | "anos";

export const FREQUENCIES: Frequency[] = ["diaria", "semanal", "mensal"];
export const INTERVAL_UNITS: IntervalUnit[] = ["dias", "semanas", "meses", "anos"];

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  notes: string | null;
  done: boolean;
  done_at: string | null;
  pantry_item_id: string | null;
  created_at: string;
};

export type PantryItem = {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  unit: string | null;
  category: string | null;
  location: string | null;
  expires_on: string | null;
  notes: string | null;
};

export type Chore = {
  id: string;
  name: string;
  notes: string | null;
  frequency: Frequency;
  weekdays: number[] | null;
  month_day: number | null;
  rotation: string[];
  next_index: number;
  next_due_on: string | null;
  active: boolean;
};

export type ChoreLog = { id: string; chore_id: string; member_id: string | null; done_on: string };

export type Maintenance = {
  id: string;
  name: string;
  notes: string | null;
  interval_value: number;
  interval_unit: IntervalUnit;
  last_done_on: string | null;
  next_due_on: string | null;
  provider: string | null;
  active: boolean;
};

export type MaintenanceLog = { id: string; maintenance_id: string; done_on: string; cost: number | null; notes: string | null };

export const SHOPPING_COLS = "id, name, quantity, unit, category, notes, done, done_at, pantry_item_id, created_at";
export const PANTRY_COLS = "id, name, quantity, min_quantity, unit, category, location, expires_on, notes";
export const CHORE_COLS = "id, name, notes, frequency, weekdays, month_day, rotation, next_index, next_due_on, active";
export const CHORE_LOG_COLS = "id, chore_id, member_id, done_on";
export const MAINTENANCE_COLS = "id, name, notes, interval_value, interval_unit, last_done_on, next_due_on, provider, active";
export const MAINTENANCE_LOG_COLS = "id, maintenance_id, done_on, cost, notes";

/** O PostgREST devolve numeric como número; garante número mesmo se vier texto. */
export const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
