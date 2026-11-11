/**
 * Validação de entrada da Casa. Roda no servidor; no navegador só ajuda.
 * household_id nunca vem do formulário: as actions usam getAppContext().
 */
import { isDate } from "@/lib/agenda/dates";
import { parseBRL } from "@/lib/financas/money";
import { DOC_KINDS, FREQUENCIES, INTERVAL_UNITS, MEALS, type DocKind, type Frequency, type IntervalUnit, type Meal } from "./types";

export const LIMITS = {
  name: 120,
  unit: 20,
  category: 40,
  shoppingNotes: 300,
  choreNotes: 500,
  maintNotes: 500,
  provider: 120,
  rotation: 10,
  intervalMax: 365,
  /** numeric(10,2): bem abaixo do limite da coluna. */
  quantityMax: 99999,
  costMax: 9_999_999,
  docTitle: 120,
  docProduct: 120,
  docStore: 120,
  docNotes: 1000,
  mealTitle: 120,
  ingredient: 80,
  ingredients: 30,
  mealNotes: 300,
  providerName: 120,
  providerService: 80,
  providerPhone: 30,
  providerEmail: 120,
  providerNotes: 500,
} as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type Fail = { ok: false; erro: string };
type Ok<T> = { ok: true; value: T };
const fail = (erro: string): Fail => ({ ok: false, erro });

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");
const oneLine = (v: unknown) => clean(v).replace(/\s+/g, " ");
const orNull = (s: string) => s || null;

function tooLong(label: string, s: string, max: number): Fail | null {
  return s.length > max ? fail(`${label} muito longo (máximo ${max}).`) : null;
}

/** Quantidade digitada ("2", "1,5", "0.25"): número com até 2 casas, ou null se vazio. "x" = inválido. */
export function parseQuantity(v: unknown): number | null | "x" {
  const s = clean(v).replace(",", ".");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "x";
  const n = Number(s);
  return Number.isFinite(n) ? n : "x";
}

/** Converte FormData em objeto simples; campos repetidos (dias da semana, rodízio) viram lista. */
export function formToObject(form: FormData, lists: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !lists.includes(k)) out[k] = v;
  for (const k of lists) out[k] = form.getAll(k).filter((v): v is string => typeof v === "string");
  return out;
}

/* ---------- Lista de compras ---------- */

export type ShoppingInput = { name: string; quantity: number | null; unit: string | null; category: string | null; notes: string | null };

export function validateShoppingInput(raw: Record<string, unknown>): Ok<ShoppingInput> | Fail {
  const name = oneLine(raw.name);
  if (!name) return fail("Informe o item.");
  const unit = oneLine(raw.unit);
  const category = oneLine(raw.category);
  const notes = clean(raw.notes);
  const err =
    tooLong("Item", name, LIMITS.name) ??
    tooLong("Unidade", unit, LIMITS.unit) ??
    tooLong("Categoria", category, LIMITS.category) ??
    tooLong("Observações", notes, LIMITS.shoppingNotes);
  if (err) return err;
  const q = parseQuantity(raw.quantity);
  if (q === "x" || (q !== null && (q <= 0 || q > LIMITS.quantityMax))) return fail("Quantidade inválida.");
  return { ok: true, value: { name, quantity: q, unit: orNull(unit), category: orNull(category), notes: orNull(notes) } };
}

/* ---------- Tarefas domésticas ---------- */

export type ChoreInput = {
  name: string;
  notes: string | null;
  frequency: Frequency;
  weekdays: number[] | null;
  month_day: number | null;
  rotation: string[];
};

/** `memberIds`: members da família (do servidor). Rodízio: 1 a 10 posições na ordem escolhida (pode repetir pessoa). */
export function validateChoreInput(raw: Record<string, unknown>, memberIds: string[]): Ok<ChoreInput> | Fail {
  const name = oneLine(raw.name);
  if (!name) return fail("Informe a tarefa.");
  const notes = clean(raw.notes);
  const err = tooLong("Tarefa", name, LIMITS.name) ?? tooLong("Observações", notes, LIMITS.choreNotes);
  if (err) return err;

  const frequency = clean(raw.frequency) as Frequency;
  if (!FREQUENCIES.includes(frequency)) return fail("Escolha a frequência.");

  let weekdays: number[] | null = null;
  let monthDay: number | null = null;
  if (frequency === "semanal") {
    const list = Array.isArray(raw.weekdays) ? raw.weekdays.map((d) => clean(d)) : [];
    if (list.some((d) => !/^[0-6]$/.test(d))) return fail("Dia da semana inválido.");
    weekdays = [...new Set(list.map(Number))].sort((a, b) => a - b);
    if (weekdays.length === 0) return fail("Escolha ao menos um dia da semana.");
  } else if (frequency === "mensal") {
    const d = clean(raw.month_day);
    if (!/^\d{1,2}$/.test(d) || +d < 1 || +d > 31) return fail("Escolha o dia do mês (1 a 31).");
    monthDay = +d;
  }

  const rotation = Array.isArray(raw.rotation) ? raw.rotation.map((r) => clean(r)) : [];
  if (rotation.length === 0) return fail("Escolha quem participa do rodízio.");
  if (rotation.length > LIMITS.rotation) return fail(`No máximo ${LIMITS.rotation} pessoas no rodízio.`);
  if (rotation.some((id) => !UUID_RE.test(id) || !memberIds.includes(id))) return fail("Escolha pessoas da família.");

  return { ok: true, value: { name, notes: orNull(notes), frequency, weekdays, month_day: monthDay, rotation } };
}

/** Mensagem clara para os erros do trigger do rodízio (0015): 23503 = pessoa de fora; 23514 = posição ou dia inválido. */
export function choreDbError(code: string | undefined) {
  if (code === "23503") return "Alguém do rodízio não é mais da família. Revise as pessoas e salve de novo.";
  if (code === "23514") return "Rodízio ou dias da semana inválidos. Revise e salve de novo.";
  return "Não foi possível salvar. Tente de novo.";
}

/* ---------- Manutenção ---------- */

export type MaintenanceInput = {
  name: string;
  notes: string | null;
  interval_value: number;
  interval_unit: IntervalUnit;
  last_done_on: string | null;
  provider: string | null;
  /** Só o formato (uuid) é checado aqui; a action confere se o prestador é da família. */
  provider_id: string | null;
};

export function validateMaintenanceInput(raw: Record<string, unknown>, today: string): Ok<MaintenanceInput> | Fail {
  const name = oneLine(raw.name);
  if (!name) return fail("Informe a manutenção.");
  const notes = clean(raw.notes);
  const provider = oneLine(raw.provider);
  const err = tooLong("Manutenção", name, LIMITS.name) ?? tooLong("Observações", notes, LIMITS.maintNotes) ?? tooLong("Prestador", provider, LIMITS.provider);
  if (err) return err;
  const v = clean(raw.interval_value);
  if (!/^\d{1,3}$/.test(v) || +v < 1 || +v > LIMITS.intervalMax) return fail(`Intervalo de 1 a ${LIMITS.intervalMax}.`);
  const unit = clean(raw.interval_unit) as IntervalUnit;
  if (!INTERVAL_UNITS.includes(unit)) return fail("Escolha a unidade do intervalo.");
  const last = clean(raw.last_done_on);
  if (last && !isDate(last)) return fail("Data da última vez inválida.");
  if (last && last > today) return fail("A última vez não pode ser no futuro.");
  const providerId = clean(raw.provider_id);
  if (providerId && !UUID_RE.test(providerId)) return fail("Escolha um prestador da lista.");
  return {
    ok: true,
    value: { name, notes: orNull(notes), interval_value: +v, interval_unit: unit, last_done_on: orNull(last), provider: orNull(provider), provider_id: orNull(providerId.toLowerCase()) },
  };
}

export type MaintenanceDoneInput = { done_on: string; cost: number | null; notes: string | null };

/** "Feita": data (padrão hoje, nunca no futuro), custo opcional em reais e observação. */
export function validateMaintenanceDone(raw: Record<string, unknown>, today: string): Ok<MaintenanceDoneInput> | Fail {
  const date = clean(raw.done_on) || today;
  if (!isDate(date)) return fail("Data inválida.");
  if (date > today) return fail("A data não pode ser no futuro.");
  const costRaw = clean(raw.cost);
  let cost: number | null = null;
  if (costRaw) {
    const c = parseBRL(costRaw);
    if (c === null || c < 0 || c > LIMITS.costMax) return fail("Custo inválido.");
    cost = c;
  }
  const notes = clean(raw.notes);
  const err = tooLong("Observações", notes, LIMITS.maintNotes);
  if (err) return err;
  return { ok: true, value: { done_on: date, cost, notes: orNull(notes) } };
}

/* ---------- Documentos e garantias ---------- */

export type DocumentInput = {
  kind: DocKind;
  title: string;
  product: string | null;
  store: string | null;
  purchase_date: string | null;
  warranty_until: string | null;
  amount: number | null;
  notes: string | null;
};

export function validateDocumentInput(raw: Record<string, unknown>): Ok<DocumentInput> | Fail {
  const kind = clean(raw.kind) as DocKind;
  if (!DOC_KINDS.includes(kind)) return fail("Escolha o tipo do documento.");
  const title = oneLine(raw.title);
  if (!title) return fail("Informe o título.");
  const product = oneLine(raw.product);
  const store = oneLine(raw.store);
  const notes = clean(raw.notes);
  const err =
    tooLong("Título", title, LIMITS.docTitle) ??
    tooLong("Produto", product, LIMITS.docProduct) ??
    tooLong("Loja", store, LIMITS.docStore) ??
    tooLong("Observações", notes, LIMITS.docNotes);
  if (err) return err;
  const purchase = clean(raw.purchase_date);
  const until = clean(raw.warranty_until);
  if (purchase && !isDate(purchase)) return fail("Data da compra inválida.");
  if (until && !isDate(until)) return fail("Data da garantia inválida.");
  if (purchase && until && until < purchase) return fail("A garantia não pode terminar antes da compra.");
  const amountRaw = clean(raw.amount);
  let amount: number | null = null;
  if (amountRaw) {
    const a = parseBRL(amountRaw);
    if (a === null || a < 0 || a > LIMITS.costMax) return fail("Valor inválido.");
    amount = a;
  }
  return {
    ok: true,
    value: { kind, title, product: orNull(product), store: orNull(store), purchase_date: orNull(purchase), warranty_until: orNull(until), amount, notes: orNull(notes) },
  };
}

/* ---------- Cardápio ---------- */

/** Chave de comparação de nomes: sem acento, minúsculas e espaços simples ("Feijão " = "feijao"). */
export const nameKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Ingredientes: um por linha; vazios saem, repetidos (sem acento/maiúscula) ficam uma vez. */
export function parseIngredients(v: unknown): Ok<string[]> | Fail {
  const lines = clean(v)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    if (l.length > LIMITS.ingredient) return fail(`Ingrediente muito longo (máximo ${LIMITS.ingredient}).`);
    const k = nameKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  if (out.length > LIMITS.ingredients) return fail(`No máximo ${LIMITS.ingredients} ingredientes.`);
  return { ok: true, value: out };
}

export type MealInput = { day: string; meal: Meal; title: string; ingredients: string[]; notes: string | null };

export function validateMealInput(raw: Record<string, unknown>): Ok<MealInput> | Fail {
  const day = clean(raw.day);
  if (!isDate(day)) return fail("Dia inválido.");
  const meal = clean(raw.meal) as Meal;
  if (!MEALS.includes(meal)) return fail("Refeição inválida.");
  const title = oneLine(raw.title);
  if (!title) return fail("Informe o prato.");
  const notes = clean(raw.notes);
  const err = tooLong("Prato", title, LIMITS.mealTitle) ?? tooLong("Observações", notes, LIMITS.mealNotes);
  if (err) return err;
  const ing = parseIngredients(raw.ingredients);
  if (!ing.ok) return ing;
  return { ok: true, value: { day, meal, title, ingredients: ing.value, notes: orNull(notes) } };
}

/* ---------- Prestadores ---------- */

export type ProviderInput = { name: string; service: string | null; phone: string | null; email: string | null; notes: string | null };

const PHONE_RE = /^[0-9 +()-]+$/;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export function validateProviderInput(raw: Record<string, unknown>): Ok<ProviderInput> | Fail {
  const name = oneLine(raw.name);
  if (!name) return fail("Informe o nome.");
  const service = oneLine(raw.service);
  const phone = oneLine(raw.phone);
  const email = clean(raw.email);
  const notes = clean(raw.notes);
  const err =
    tooLong("Nome", name, LIMITS.providerName) ??
    tooLong("Serviço", service, LIMITS.providerService) ??
    tooLong("Telefone", phone, LIMITS.providerPhone) ??
    tooLong("E-mail", email, LIMITS.providerEmail) ??
    tooLong("Observações", notes, LIMITS.providerNotes);
  if (err) return err;
  if (phone && !PHONE_RE.test(phone)) return fail("Telefone só com números, espaços, +, - e parênteses.");
  if (email && !EMAIL_RE.test(email)) return fail("E-mail inválido.");
  return { ok: true, value: { name, service: orNull(service), phone: orNull(phone), email: orNull(email), notes: orNull(notes) } };
}
