/** Tipos à mão das tabelas da Casa (0015_casa_parte_1.sql e 0017_casa_parte_2.sql); os tipos do Supabase ainda não são gerados. */
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
  created_at: string;
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
  provider_id: string | null;
  active: boolean;
};

export type MaintenanceLog = { id: string; maintenance_id: string; done_on: string; cost: number | null; notes: string | null };

export const SHOPPING_COLS = "id, name, quantity, unit, category, notes, done, done_at, created_at";
export const CHORE_COLS = "id, name, notes, frequency, weekdays, month_day, rotation, next_index, next_due_on, active";
export const CHORE_LOG_COLS = "id, chore_id, member_id, done_on";
export const MAINTENANCE_COLS = "id, name, notes, interval_value, interval_unit, last_done_on, next_due_on, provider, provider_id, active";
export const MAINTENANCE_LOG_COLS = "id, maintenance_id, done_on, cost, notes";

/* ---------- Parte 2 (0017) ---------- */

export type DocKind = "garantia" | "manual" | "nota_fiscal" | "contrato" | "outro";
export const DOC_KINDS: DocKind[] = ["garantia", "manual", "nota_fiscal", "contrato", "outro"];
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  garantia: "Garantia",
  manual: "Manual",
  nota_fiscal: "Nota fiscal",
  contrato: "Contrato",
  outro: "Outro",
};

export type CasaDocument = {
  id: string;
  kind: DocKind;
  title: string;
  product: string | null;
  store: string | null;
  purchase_date: string | null;
  warranty_until: string | null;
  amount: number | null;
  notes: string | null;
  file_path: string | null;
  file_mime: "application/pdf" | "image/jpeg" | null;
  file_size: number | null;
};

export type Meal = "cafe" | "almoco" | "lanche" | "jantar";
export const MEALS: Meal[] = ["cafe", "almoco", "lanche", "jantar"];
export const MEAL_LABEL: Record<Meal, string> = { cafe: "Café da manhã", almoco: "Almoço", lanche: "Lanche", jantar: "Jantar" };

export type MealPlan = { id: string; day: string; meal: Meal; title: string; ingredients: string[]; notes: string | null };

export type Provider = { id: string; name: string; service: string | null; phone: string | null; email: string | null; notes: string | null };

export const DOCUMENT_COLS = "id, kind, title, product, store, purchase_date, warranty_until, amount, notes, file_path, file_mime, file_size";
export const MEAL_COLS = "id, day, meal, title, ingredients, notes";
export const PROVIDER_COLS = "id, name, service, phone, email, notes";

/** O PostgREST devolve numeric como número; garante número mesmo se vier texto. */
export const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
