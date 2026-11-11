/**
 * Aba Pet da Casa (0018_casa_pet.sql): tipos à mão e regras puras (testadas em tests/unit/casa-pet.test.ts).
 * Datas "AAAA-MM-DD" do dia de São Paulo.
 */
import { addDays, diffDays } from "@/lib/agenda/dates";
import { nextMaintenanceDue } from "./schedule";

export type Species = "cachorro" | "gato" | "outro";
export type PetSex = "macho" | "femea";
export type PetHealthKind = "vacina" | "vermifugo" | "antipulgas" | "remedio";
export type PetVetKind = "consulta" | "exame" | "receita" | "outro";
export type PetCareUnit = "dias" | "semanas" | "meses";
export type FileMime = "application/pdf" | "image/jpeg";

export const SPECIES: Species[] = ["cachorro", "gato", "outro"];
export const SPECIES_LABEL: Record<Species, string> = { cachorro: "Cachorro", gato: "Gato", outro: "Outro" };
export const PET_SEXES: PetSex[] = ["macho", "femea"];
export const PET_SEX_LABEL: Record<PetSex, string> = { macho: "Macho", femea: "Fêmea" };
export const PET_HEALTH_KINDS: PetHealthKind[] = ["vacina", "vermifugo", "antipulgas", "remedio"];
export const PET_HEALTH_LABEL: Record<PetHealthKind, string> = { vacina: "Vacina", vermifugo: "Vermífugo", antipulgas: "Antipulgas", remedio: "Remédio" };
export const PET_HEALTH_GROUP: Record<PetHealthKind, string> = { vacina: "Vacinas", vermifugo: "Vermífugos", antipulgas: "Antipulgas", remedio: "Remédios" };
export const PET_VET_KINDS: PetVetKind[] = ["consulta", "exame", "receita", "outro"];
export const PET_VET_LABEL: Record<PetVetKind, string> = { consulta: "Consulta", exame: "Exame", receita: "Receita", outro: "Outro" };
export const PET_CARE_UNITS: PetCareUnit[] = ["dias", "semanas", "meses"];

export type Pet = { id: string; name: string; species: Species; breed: string | null; sex: PetSex | null; birth_date: string | null; notes: string | null; photo_v: string | null };

export type PetHealth = {
  id: string;
  pet_id: string;
  kind: PetHealthKind;
  name: string;
  dose: string | null;
  applied_on: string | null;
  next_due_on: string | null;
  notes: string | null;
  file_mime: FileMime | null;
  file_size: number | null;
  created_at: string;
};

export type PetVet = {
  id: string;
  pet_id: string;
  kind: PetVetKind;
  happened_on: string;
  clinic: string | null;
  vet: string | null;
  reason: string | null;
  notes: string | null;
  cost: number | null;
  file_mime: FileMime | null;
  file_size: number | null;
};

export type PetCare = {
  id: string;
  pet_id: string;
  name: string;
  interval_value: number;
  interval_unit: PetCareUnit;
  last_done_on: string | null;
  next_due_on: string | null;
  provider_id: string | null;
  active: boolean;
  notes: string | null;
};

export type PetCareLog = { id: string; care_id: string; done_on: string; cost: number | null; notes: string | null };
export type PetWeight = { id: string; pet_id: string; measured_on: string; weight_kg: number };
export type PetFood = { id: string; pet_id: string; brand: string; bag_kg: number; daily_grams: number | null; started_on: string; active: boolean; notes: string | null };

/** photo_path só é lido no servidor: a página troca por `photo_v` (uuid do arquivo) antes de ir ao navegador. */
export const PET_COLS = "id, name, species, breed, sex, birth_date, notes, photo_path";
export const PET_HEALTH_COLS = "id, pet_id, kind, name, dose, applied_on, next_due_on, notes, file_mime, file_size, created_at";
export const PET_VET_COLS = "id, pet_id, kind, happened_on, clinic, vet, reason, notes, cost, file_mime, file_size";
export const PET_CARE_COLS = "id, pet_id, name, interval_value, interval_unit, last_done_on, next_due_on, provider_id, active, notes";
export const PET_CARE_LOG_COLS = "id, care_id, done_on, cost, notes";
export const PET_WEIGHT_COLS = "id, pet_id, measured_on, weight_kg";
export const PET_FOOD_COLS = "id, pet_id, brand, bag_kg, daily_grams, started_on, active, notes";

/** Tabelas com anexo e o segmento da URL da rota autenticada /casa/pet/arquivo/{tipo}/{id} (lista fechada). */
export const PET_FILE_TABLES = { saude: "casa_pet_health", veterinario: "casa_pet_vet" } as const;
export type PetFileKind = keyof typeof PET_FILE_TABLES;
export const isPetFileKind = (v: unknown): v is PetFileKind => v === "saude" || v === "veterinario";
export const petFileHref = (kind: PetFileKind, id: string) => `/casa/pet/arquivo/${kind}/${id}`;

export const DOSE_SOON_DAYS = 7;
export const FOOD_LOW_DAYS = 5;

/* ---------- Seleção do pet ---------- */

/** Pet mostrado: o pedido na URL (se for da família) ou o primeiro em ordem alfabética. null se não houver pets. */
export function pickPet<T extends { id: string; name: string }>(pets: T[], requested: unknown): T | null {
  const sorted = sortPets(pets);
  if (typeof requested === "string") {
    const hit = sorted.find((p) => p.id === requested.toLowerCase());
    if (hit) return hit;
  }
  return sorted[0] ?? null;
}

export const sortPets = <T extends { name: string }>(pets: T[]) => [...pets].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

/** Idade a partir do nascimento: "2 anos", "1 ano e 3 meses", "5 meses", "menos de 1 mês". */
export function petAge(birth: string | null, today: string): string | null {
  if (!birth || birth > today) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 1) return "menos de 1 mês";
  const years = Math.floor(months / 12);
  months %= 12;
  const y = years ? `${years} ano${years === 1 ? "" : "s"}` : "";
  const m = months ? `${months} ${months === 1 ? "mês" : "meses"}` : "";
  return [y, m].filter(Boolean).join(" e ");
}

/* ---------- Vacinas e remédios ---------- */

export type DoseStatus = "atrasada" | "hoje" | "em-breve" | "em-dia";

/** Atrasada: antes de hoje. Hoje. Em breve: de amanhã até 7 dias. Sem próxima data: null. */
export function doseStatus(nextDueOn: string | null, today: string): DoseStatus | null {
  if (!nextDueOn) return null;
  const days = diffDays(today, nextDueOn);
  if (days < 0) return "atrasada";
  if (days === 0) return "hoje";
  if (days <= DOSE_SOON_DAYS) return "em-breve";
  return "em-dia";
}

/** "Atrasada há 3 dias", "Hoje", "Amanhã", "Em 5 dias", "Em dd/mm/aaaa" (texto da próxima dose). */
export function doseWhen(nextDueOn: string, today: string, br: (d: string) => string): string {
  const days = diffDays(today, nextDueOn);
  if (days < 0) return `atrasada há ${-days} dia${days === -1 ? "" : "s"}`;
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days <= DOSE_SOON_DAYS) return `em ${days} dias`;
  return `em ${br(nextDueOn)}`;
}

const byDue = <T extends { next_due_on: string | null; name: string }>(a: T, b: T) =>
  a.next_due_on!.localeCompare(b.next_due_on!) || a.name.localeCompare(b.name, "pt-BR");

/** Doses em destaque (atrasada, hoje ou em até 7 dias), da mais antiga para a mais nova. */
export function doseAlerts<T extends { next_due_on: string | null; name: string }>(items: T[], today: string): T[] {
  return items.filter((i) => {
    const s = doseStatus(i.next_due_on, today);
    return s === "atrasada" || s === "hoje" || s === "em-breve";
  }).sort(byDue);
}

/** Próxima dose: a de data mais cedo (inclui atrasadas). null se nenhuma tiver próxima data. */
export function nextDose<T extends { next_due_on: string | null; name: string }>(items: T[]): T | null {
  return items.filter((i) => i.next_due_on).sort(byDue)[0] ?? null;
}

/**
 * Itens por tipo, na ordem fixa dos tipos; dentro do tipo, os vigentes (`current`) antes do histórico,
 * próxima dose primeiro e depois a aplicação mais recente.
 */
export function groupHealth<T extends { id: string; kind: PetHealthKind; next_due_on: string | null; applied_on: string | null; name: string }>(items: T[], current?: ReadonlySet<string>) {
  const sortIn = (a: T, b: T) => {
    if (current) {
      const ca = current.has(a.id);
      if (ca !== current.has(b.id)) return ca ? -1 : 1;
      if (!ca) return (b.applied_on ?? "").localeCompare(a.applied_on ?? "") || a.name.localeCompare(b.name, "pt-BR");
    }
    if (a.next_due_on && b.next_due_on) return a.next_due_on.localeCompare(b.next_due_on);
    if (a.next_due_on) return -1;
    if (b.next_due_on) return 1;
    return (b.applied_on ?? "").localeCompare(a.applied_on ?? "") || a.name.localeCompare(b.name, "pt-BR");
  };
  return PET_HEALTH_KINDS.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind).sort(sortIn) })).filter((g) => g.items.length > 0);
}

/* ---------- Dose mais recente ---------- */

type HealthKeyed = { id: string; pet_id: string; kind: string; name: string; applied_on: string | null; created_at: string };

const healthName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Grupo da dose: mesmo pet, tipo e nome (sem acento/maiúscula/espaços extras). */
export const healthGroupKey = (h: { pet_id: string; kind: string; name: string }) => `${h.pet_id}|${h.kind}|${healthName(h.name)}`;

/** Mais recente primeiro: aplicação desc (sem data por último), depois criação desc (e id, para empate estável). */
export function compareHealthRecency(a: HealthKeyed, b: HealthKeyed) {
  if (a.applied_on !== b.applied_on) {
    if (!a.applied_on) return 1;
    if (!b.applied_on) return -1;
    return b.applied_on.localeCompare(a.applied_on);
  }
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

/**
 * Ids dos registros que valem para a "próxima dose": só o mais recente de cada grupo.
 * Os anteriores ficam como histórico (dose nova da V10 apaga o "atrasada" da antiga).
 */
export function currentHealthIds<T extends HealthKeyed>(items: T[]): Set<string> {
  const best = new Map<string, T>();
  for (const h of items) {
    const k = healthGroupKey(h);
    const cur = best.get(k);
    if (!cur || compareHealthRecency(h, cur) < 0) best.set(k, h);
  }
  return new Set([...best.values()].map((h) => h.id));
}

/** Só os registros vigentes (mais recentes de cada grupo). */
export const currentHealth = <T extends HealthKeyed>(items: T[]) => {
  const ids = currentHealthIds(items);
  return items.filter((h) => ids.has(h.id));
};

/* ---------- Cuidados recorrentes ---------- */

/** Mesma conta da Manutenção: última vez + intervalo (meses ajustam para o último dia do mês). */
export const nextCareDue = (lastDoneOn: string | null, value: number, unit: PetCareUnit) => nextMaintenanceDue(lastDoneOn, value, unit);

/** Cuidados ativos vencidos (antes de hoje). */
export const overdueCare = <T extends { active: boolean; next_due_on: string | null }>(list: T[], today: string) =>
  list.filter((c) => c.active && c.next_due_on !== null && c.next_due_on < today);

export type CareExpected = { last_done_on: string | null; next_due_on: string | null };
export type CareState = CareExpected & { id: string; interval_value: number; interval_unit: PetCareUnit };
export type CareRepo = {
  read(): Promise<CareState | null>;
  /** Grava só se last_done_on e next_due_on ainda forem `expected`. true = esta chamada gravou; { code } = erro. */
  updateIf(expected: CareExpected, patch: CareExpected): Promise<boolean | { code?: string }>;
  insertLog(row: { done_on: string; cost: number | null; notes: string | null }): Promise<boolean>;
};

export const STALE_CARE = "Este cuidado já foi atualizado em outro aparelho. Confira e registre de novo se precisar.";
const sameCare = (a: CareExpected, b: CareExpected) => (a.last_done_on ?? null) === (b.last_done_on ?? null) && (a.next_due_on ?? null) === (b.next_due_on ?? null);

/**
 * "Feita" com o estado que a tela mostrou: se outro aparelho registrou antes, não registra de novo.
 * Data antiga não faz a "última vez" voltar no tempo. Ordem: atualiza (condicional) e grava o histórico;
 * se o histórico falhar, desfaz a atualização (também condicional).
 */
export async function completeCareWith(
  repo: CareRepo,
  expected: CareExpected,
  done: { done_on: string; cost: number | null; notes: string | null },
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const c = await repo.read();
  if (!c) return { ok: false, erro: "Cuidado não encontrado." };
  if (!sameCare(c, expected)) return { ok: false, erro: STALE_CARE };
  const last = c.last_done_on && c.last_done_on > done.done_on ? c.last_done_on : done.done_on;
  const patch = { last_done_on: last, next_due_on: nextCareDue(last, c.interval_value, c.interval_unit) };
  const u = await repo.updateIf(expected, patch);
  if (typeof u === "object") return { ok: false, erro: "Não foi possível registrar. Tente de novo." };
  if (!u) return { ok: false, erro: STALE_CARE };
  if (!(await repo.insertLog(done))) {
    await repo.updateIf(patch, expected);
    return { ok: false, erro: "Não foi possível registrar. Tente de novo." };
  }
  return { ok: true };
}

/* ---------- Peso ---------- */

/** Histórico do mais recente para o mais antigo, com a variação em relação à medição anterior (kg, 2 casas). */
export function weightHistory<T extends { measured_on: string; weight_kg: number }>(list: T[]) {
  const sorted = [...list].sort((a, b) => b.measured_on.localeCompare(a.measured_on));
  return sorted.map((w, i) => {
    const prev = sorted[i + 1];
    return { ...w, delta: prev ? Math.round((w.weight_kg - prev.weight_kg) * 100) / 100 : null };
  });
}

/* ---------- Ração ---------- */

export type FoodForecast = { days: number; endsOn: string; daysLeft: number; low: boolean };

/**
 * Previsão de quando o saco acaba: (kg × 1000) ÷ gramas por dia, em dias inteiros a partir do início.
 * Sem gramas por dia: sem previsão. `low` quando faltam 5 dias ou menos (inclui já acabada).
 */
export function foodForecast(food: { bag_kg: number; daily_grams: number | null; started_on: string }, today: string): FoodForecast | null {
  if (!food.daily_grams || food.daily_grams <= 0 || !(food.bag_kg > 0)) return null;
  const grams = Math.round(food.bag_kg * 100) * 10; // gramas inteiras, sem erro de ponto flutuante
  const days = Math.floor(grams / food.daily_grams);
  const endsOn = addDays(food.started_on, days);
  const daysLeft = diffDays(today, endsOn);
  return { days, endsOn, daysLeft, low: daysLeft <= FOOD_LOW_DAYS };
}

/** Nome do item na lista de compras (até 120 caracteres, o limite da lista). */
export const foodShoppingName = (brand: string) => `Ração ${brand.replace(/\s+/g, " ").trim()}`.slice(0, 120).trim();

/* ---------- Resumo da Casa ---------- */

/**
 * Linhas do card do Pet no Resumo: próxima dose (com o nome do pet), cuidados vencidos e ração acabando.
 * Só dados já filtrados pela família no servidor.
 */
export function petSummary(
  d: {
    pets: { id: string; name: string }[];
    health: { id: string; pet_id: string; kind: PetHealthKind; name: string; dose: string | null; applied_on: string | null; next_due_on: string | null; created_at: string }[];
    care: { active: boolean; next_due_on: string | null }[];
    food: { pet_id: string; bag_kg: number; daily_grams: number | null; started_on: string }[];
  },
  today: string,
  br: (date: string) => string,
): string[] {
  if (d.pets.length === 0) return ["Nenhum pet cadastrado."];
  const names = new Map(d.pets.map((p) => [p.id, p.name]));
  const many = d.pets.length > 1;
  const who = (petId: string) => (many && names.has(petId) ? `${names.get(petId)}: ` : "");
  const lines: string[] = [];
  const next = nextDose(currentHealth(d.health.filter((h) => names.has(h.pet_id))));
  lines.push(
    next
      ? `Próxima dose: ${who(next.pet_id)}${PET_HEALTH_LABEL[next.kind]} ${next.name}${next.dose ? ` - ${next.dose}` : ""} (${doseWhen(next.next_due_on!, today, br)})`
      : "Nenhuma dose agendada.",
  );
  const overdue = overdueCare(d.care, today).length;
  lines.push(`${overdue} ${overdue === 1 ? "cuidado vencido" : "cuidados vencidos"}`);
  const low = d.food.filter((f) => names.has(f.pet_id) && foodForecast(f, today)?.low);
  if (low.length > 0) lines.push(many ? `Ração acabando: ${[...new Set(low.map((f) => names.get(f.pet_id)))].join(", ")}` : "Ração acabando");
  return lines;
}
