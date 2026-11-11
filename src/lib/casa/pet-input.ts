/**
 * Validação de entrada da aba Pet. Roda no servidor; no navegador só ajuda.
 * household_id nunca vem do formulário; pet_id/provider_id só têm o formato checado aqui e a action
 * confere se são da família (as FKs compostas da 0018 barram de novo).
 */
import { isDate } from "@/lib/agenda/dates";
import { parseBRL } from "@/lib/financas/money";
import { LIMITS as CASA_LIMITS, UUID_RE } from "./input";
import { PET_CARE_UNITS, PET_HEALTH_KINDS, PET_SEXES, PET_VET_KINDS, SPECIES, type PetCareUnit, type PetHealthKind, type PetSex, type PetVetKind, type Species } from "./pet";

export const PET_LIMITS = {
  petName: 60,
  breed: 60,
  petNotes: 500,
  healthName: 120,
  dose: 60,
  healthNotes: 500,
  clinic: 120,
  vet: 120,
  reason: 200,
  vetNotes: 2000,
  careName: 120,
  careNotes: 500,
  intervalMax: 365,
  brand: 120,
  bagMax: 100,
  dailyMax: 5000,
  foodNotes: 300,
  weightMax: 200,
  costMax: CASA_LIMITS.costMax,
} as const;

type Fail = { ok: false; erro: string };
type Ok<T> = { ok: true; value: T };
const fail = (erro: string): Fail => ({ ok: false, erro });

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");
const oneLine = (v: unknown) => clean(v).replace(/\s+/g, " ");
const orNull = (s: string) => s || null;
const tooLong = (label: string, s: string, max: number): Fail | null => (s.length > max ? fail(`${label} muito longo (máximo ${max}).`) : null);

function uuidOf(v: unknown): string | null {
  const s = clean(v);
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

/** Decimal digitado ("12,5", "0.25"): até 2 casas; null se vazio; "x" se inválido. */
export function parseDecimal(v: unknown): number | null | "x" {
  const s = clean(v).replace(",", ".");
  if (!s) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return "x";
  return Number(s);
}

function parseCost(v: unknown): number | null | "x" {
  const s = clean(v);
  if (!s) return null;
  const c = parseBRL(s);
  if (c === null || c < 0 || c > PET_LIMITS.costMax) return "x";
  return c;
}

/* ---------- Pet ---------- */

export type PetInput = { name: string; species: Species; breed: string | null; sex: PetSex | null; birth_date: string | null; notes: string | null };

export function validatePetInput(raw: Record<string, unknown>, today: string): Ok<PetInput> | Fail {
  const name = oneLine(raw.name);
  if (!name) return fail("Informe o nome do pet.");
  const breed = oneLine(raw.breed);
  const notes = clean(raw.notes);
  const err = tooLong("Nome", name, PET_LIMITS.petName) ?? tooLong("Raça", breed, PET_LIMITS.breed) ?? tooLong("Observações", notes, PET_LIMITS.petNotes);
  if (err) return err;
  const species = clean(raw.species) as Species;
  if (!SPECIES.includes(species)) return fail("Escolha a espécie.");
  const sex = clean(raw.sex);
  if (sex && !PET_SEXES.includes(sex as PetSex)) return fail("Sexo inválido.");
  const birth = clean(raw.birth_date);
  if (birth && !isDate(birth)) return fail("Data de nascimento inválida.");
  if (birth && birth > today) return fail("O nascimento não pode ser no futuro.");
  return { ok: true, value: { name, species, breed: orNull(breed), sex: (sex || null) as PetSex | null, birth_date: orNull(birth), notes: orNull(notes) } };
}

/* ---------- Vacinas e remédios ---------- */

export type PetHealthInput = { pet_id: string; kind: PetHealthKind; name: string; dose: string | null; applied_on: string | null; next_due_on: string | null; notes: string | null };

export function validatePetHealthInput(raw: Record<string, unknown>): Ok<PetHealthInput> | Fail {
  const petId = uuidOf(raw.pet_id);
  if (!petId) return fail("Pet inválido.");
  const kind = clean(raw.kind) as PetHealthKind;
  if (!PET_HEALTH_KINDS.includes(kind)) return fail("Escolha o tipo.");
  const name = oneLine(raw.name);
  if (!name) return fail("Informe o nome.");
  const dose = oneLine(raw.dose);
  const notes = clean(raw.notes);
  const err = tooLong("Nome", name, PET_LIMITS.healthName) ?? tooLong("Dose", dose, PET_LIMITS.dose) ?? tooLong("Observações", notes, PET_LIMITS.healthNotes);
  if (err) return err;
  const applied = clean(raw.applied_on);
  const next = clean(raw.next_due_on);
  if (applied && !isDate(applied)) return fail("Data de aplicação inválida.");
  if (next && !isDate(next)) return fail("Data da próxima dose inválida.");
  if (applied && next && next < applied) return fail("A próxima dose não pode ser antes da aplicação.");
  return { ok: true, value: { pet_id: petId, kind, name, dose: orNull(dose), applied_on: orNull(applied), next_due_on: orNull(next), notes: orNull(notes) } };
}

/* ---------- Veterinário ---------- */

export type PetVetInput = {
  pet_id: string;
  kind: PetVetKind;
  happened_on: string;
  clinic: string | null;
  vet: string | null;
  reason: string | null;
  notes: string | null;
  cost: number | null;
};

export function validatePetVetInput(raw: Record<string, unknown>): Ok<PetVetInput> | Fail {
  const petId = uuidOf(raw.pet_id);
  if (!petId) return fail("Pet inválido.");
  const kind = clean(raw.kind) as PetVetKind;
  if (!PET_VET_KINDS.includes(kind)) return fail("Escolha o tipo.");
  const date = clean(raw.happened_on);
  if (!isDate(date)) return fail("Informe a data.");
  const clinic = oneLine(raw.clinic);
  const vet = oneLine(raw.vet);
  const reason = oneLine(raw.reason);
  const notes = clean(raw.notes);
  const err =
    tooLong("Clínica", clinic, PET_LIMITS.clinic) ??
    tooLong("Veterinário", vet, PET_LIMITS.vet) ??
    tooLong("Motivo", reason, PET_LIMITS.reason) ??
    tooLong("Observações", notes, PET_LIMITS.vetNotes);
  if (err) return err;
  const cost = parseCost(raw.cost);
  if (cost === "x") return fail("Custo inválido.");
  return { ok: true, value: { pet_id: petId, kind, happened_on: date, clinic: orNull(clinic), vet: orNull(vet), reason: orNull(reason), notes: orNull(notes), cost } };
}

/* ---------- Cuidados recorrentes ---------- */

export type PetCareInput = {
  pet_id: string;
  name: string;
  interval_value: number;
  interval_unit: PetCareUnit;
  last_done_on: string | null;
  provider_id: string | null;
  notes: string | null;
};

export function validatePetCareInput(raw: Record<string, unknown>, today: string): Ok<PetCareInput> | Fail {
  const petId = uuidOf(raw.pet_id);
  if (!petId) return fail("Pet inválido.");
  const name = oneLine(raw.name);
  if (!name) return fail("Informe o cuidado.");
  const notes = clean(raw.notes);
  const err = tooLong("Cuidado", name, PET_LIMITS.careName) ?? tooLong("Observações", notes, PET_LIMITS.careNotes);
  if (err) return err;
  const v = clean(raw.interval_value);
  if (!/^\d{1,3}$/.test(v) || +v < 1 || +v > PET_LIMITS.intervalMax) return fail(`Intervalo de 1 a ${PET_LIMITS.intervalMax}.`);
  const unit = clean(raw.interval_unit) as PetCareUnit;
  if (!PET_CARE_UNITS.includes(unit)) return fail("Escolha a unidade do intervalo.");
  const last = clean(raw.last_done_on);
  if (last && !isDate(last)) return fail("Data da última vez inválida.");
  if (last && last > today) return fail("A última vez não pode ser no futuro.");
  const prov = clean(raw.provider_id);
  if (prov && !UUID_RE.test(prov)) return fail("Escolha um prestador da lista.");
  return {
    ok: true,
    value: { pet_id: petId, name, interval_value: +v, interval_unit: unit, last_done_on: orNull(last), provider_id: prov ? prov.toLowerCase() : null, notes: orNull(notes) },
  };
}

export type PetCareDoneInput = { done_on: string; cost: number | null; notes: string | null };

export function validatePetCareDone(raw: Record<string, unknown>, today: string): Ok<PetCareDoneInput> | Fail {
  const date = clean(raw.done_on) || today;
  if (!isDate(date)) return fail("Data inválida.");
  if (date > today) return fail("A data não pode ser no futuro.");
  const cost = parseCost(raw.cost);
  if (cost === "x") return fail("Custo inválido.");
  const notes = clean(raw.notes);
  const err = tooLong("Observações", notes, PET_LIMITS.careNotes);
  if (err) return err;
  return { ok: true, value: { done_on: date, cost, notes: orNull(notes) } };
}

/** Estado que a tela mostrou (vem do navegador): datas válidas ou vazias. */
export function parseCareExpected(raw: Record<string, unknown>): { last_done_on: string | null; next_due_on: string | null } | null {
  const last = clean(raw.expected_last);
  const next = clean(raw.expected_next);
  if ((last && !isDate(last)) || (next && !isDate(next))) return null;
  return { last_done_on: orNull(last), next_due_on: orNull(next) };
}

/* ---------- Peso ---------- */

export type PetWeightInput = { pet_id: string; measured_on: string; weight_kg: number };

export function validatePetWeightInput(raw: Record<string, unknown>, today: string): Ok<PetWeightInput> | Fail {
  const petId = uuidOf(raw.pet_id);
  if (!petId) return fail("Pet inválido.");
  const date = clean(raw.measured_on) || today;
  if (!isDate(date)) return fail("Data inválida.");
  if (date > today) return fail("A data não pode ser no futuro.");
  const w = parseDecimal(raw.weight_kg);
  if (w === null) return fail("Informe o peso.");
  if (w === "x" || w <= 0 || w >= PET_LIMITS.weightMax) return fail(`Peso inválido (até ${PET_LIMITS.weightMax - 1} kg, com até 2 casas).`);
  return { ok: true, value: { pet_id: petId, measured_on: date, weight_kg: w } };
}

/* ---------- Ração ---------- */

export type PetFoodInput = { pet_id: string; brand: string; bag_kg: number; daily_grams: number | null; started_on: string; notes: string | null };

export function validatePetFoodInput(raw: Record<string, unknown>, today: string): Ok<PetFoodInput> | Fail {
  const petId = uuidOf(raw.pet_id);
  if (!petId) return fail("Pet inválido.");
  const brand = oneLine(raw.brand);
  if (!brand) return fail("Informe a ração.");
  const notes = clean(raw.notes);
  const err = tooLong("Ração", brand, PET_LIMITS.brand) ?? tooLong("Observações", notes, PET_LIMITS.foodNotes);
  if (err) return err;
  const bag = parseDecimal(raw.bag_kg);
  if (bag === null || bag === "x" || bag <= 0 || bag > PET_LIMITS.bagMax) return fail(`Peso do saco de 0,01 a ${PET_LIMITS.bagMax} kg.`);
  const g = clean(raw.daily_grams);
  if (g && (!/^\d{1,4}$/.test(g) || +g < 1 || +g > PET_LIMITS.dailyMax)) return fail(`Gramas por dia de 1 a ${PET_LIMITS.dailyMax}.`);
  const started = clean(raw.started_on) || today;
  if (!isDate(started)) return fail("Data de início inválida.");
  return { ok: true, value: { pet_id: petId, brand, bag_kg: bag, daily_grams: g ? +g : null, started_on: started, notes: orNull(notes) } };
}
