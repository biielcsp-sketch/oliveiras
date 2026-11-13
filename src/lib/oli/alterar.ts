/**
 * Escrita do Oli nas abas Casa, Pet e Igreja (etapa 2). Funções PURAS: validam os argumentos do modelo,
 * montam os valores do formulário da tela (mesmas chaves dos <input name>) e o painel de confirmação.
 * Nada é gravado aqui: a gravação acontece no Confirmar, pelas server actions das próprias telas, com os
 * valores recalculados no servidor a partir do banco (o cliente não é confiável).
 */
import { brDate } from "@/lib/agenda/dates";
import { formatBRL, parseBRL } from "@/lib/financas/money";
import { UUID_RE } from "@/lib/financas/transaction-input";
import {
  validateChoreInput,
  validateDocumentInput,
  validateMaintenanceInput,
  validateMealInput,
  validateProviderInput,
  validateShoppingInput,
} from "@/lib/casa/input";
import {
  validatePetCareInput,
  validatePetFoodInput,
  validatePetHealthInput,
  validatePetVetInput,
  validatePetWeightInput,
} from "@/lib/casa/pet-input";
import { currentResponsible, nextMaintenanceDue } from "@/lib/casa/schedule";
import { validateMaintenanceDone } from "@/lib/casa/input";
import { validatePetCareDone } from "@/lib/casa/pet-input";
import { DOC_KIND_LABEL, MEAL_LABEL } from "@/lib/casa/types";
import { nextCareDue, PET_HEALTH_LABEL, PET_VET_LABEL, type PetCareUnit } from "@/lib/casa/pet";
import type { IntervalUnit } from "@/lib/casa/types";
import { canEdit, PURPOSE_STATUS_LABEL, validateLessonInput, validatePrayerInput, validatePurposeInput, validateWordInput } from "@/lib/igreja/input";
import { matchByName, normalizeName } from "./tool-args";

export const ALTERAR_ACOES = ["criar", "editar", "apagar", "concluir", "acrescentar"] as const;
export type AlterarAcao = (typeof ALTERAR_ACOES)[number];
export type AlterarAba = "casa" | "pet" | "igreja";

export const CASA_ALTERAR = ["tarefas", "compras", "manutencao", "documentos", "cardapio", "prestadores"] as const;
export const PET_ALTERAR = ["saude", "veterinario", "cuidados", "peso", "racao"] as const;
export const IGREJA_ALTERAR = ["palavras", "promessas", "oracoes", "propositos", "carisma"] as const;

/** Tamanho máximo de um texto vindo do modelo (o validador da tela aplica o limite exato de cada campo). */
export const MAX_ARG_TEXT = 10_000;
/** Frase acrescentada a uma anotação. */
export const MAX_FRASE = 2000;

/** Valores no formato do formulário da tela (strings; listas para campos repetidos). */
export type Raw = Record<string, string | string[]>;
export type Row = Record<string, unknown>;

type Kind = "texto" | "data" | "dinheiro" | "decimal" | "inteiro" | "opcao" | "dias" | "pessoas" | "linhas" | "pet" | "sim_nao";
type Campo = { arg: string; key: string; label: string; kind: Kind; opcoes?: Record<string, string> };

export type AlterarLookup = {
  uid: string;
  me: { id: string; name: string } | null;
  members: { id: string; name: string; user_id: string | null }[];
  pets: { id: string; name: string }[];
  today: string;
};

type Check = { ok: true } | { ok: false; erro: string };
const okv = (r: { ok: boolean; erro?: string }): Check => (r.ok ? { ok: true } : { ok: false, erro: r.erro ?? "Dados inválidos." });

export type Spec = {
  aba: AlterarAba;
  secao: string;
  /** Nome do item no singular ("Tarefa"). */
  rotulo: string;
  table: string;
  cols: string;
  acoes: AlterarAcao[];
  campos: Campo[];
  rowToRaw: (row: Row) => Raw;
  defaults?: (lk: AlterarLookup) => Raw;
  validate: (raw: Raw, lk: AlterarLookup) => Check;
  titulo: (raw: Raw) => string;
  /** Campo do formulário que recebe a frase em "acrescentar" (o texto atual é mantido). */
  acrescentar?: string;
  /** Igreja: só o dono altera ou apaga (item compartilhado pelo cônjuge não). */
  dono?: boolean;
  /** Args que não mudam na edição (a tela não permite). */
  fixos?: string[];
  /** Filtro da linha (palavra x promessa na mesma tabela). */
  rowOk?: (row: Row) => string | null;
  /** "concluir": o "Feita"/"Comprado" da tela. Campos próprios (data, custo...) e o painel a partir da linha atual. */
  concluir?: {
    campos: Campo[];
    plan: (row: Row, raw: Raw, lk: AlterarLookup) => { ok: true; campos: AlteracaoCampo[]; raw: Raw } | { ok: false; erro: string };
  };
};

/* ---------- Conversões ---------- */

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const on = (v: unknown) => (v === true ? "on" : "");
const str = (r: Raw, k: string) => {
  const v = r[k];
  return Array.isArray(v) ? v.join(",") : (v ?? "");
};

const UNIDADES_INTERVALO = { dias: "dias", semanas: "semanas", meses: "meses", anos: "anos" };
const FREQ = { diaria: "Diária", semanal: "Semanal", mensal: "Mensal" };
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAY_PREFIX = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

/** Opção por chave ou pelo rótulo, sem acento/caixa ("Nota fiscal" → nota_fiscal; "Café da manhã" → cafe). */
export function matchOpcao(v: string, opcoes: Record<string, string>): string | null {
  const n = normalizeName(v);
  const key = n.replace(/[\s-]+/g, "_");
  if (key in opcoes) return key;
  const byLabel = Object.entries(opcoes).find(([, label]) => normalizeName(label) === n);
  return byLabel ? byLabel[0] : null;
}

function dia(v: unknown): string {
  if (typeof v === "number") return String(v);
  const t = normalizeName(String(v ?? ""));
  if (/^[0-6]$/.test(t)) return t;
  const i = WEEKDAY_PREFIX.findIndex((p) => t.startsWith(p));
  return i >= 0 ? String(i) : "x";
}

const listOf = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s*(?:,|;|\be\b)\s*/).filter(Boolean) : [v];

const EU = /^(eu|mim|minha|meu)$/i;

/** Arg do modelo → valor do formulário. Erro curto (volta ao modelo) quando não dá para converter. */
function toForm(c: Campo, v: unknown, lk: AlterarLookup): { ok: true; value: string | string[] } | { ok: false; erro: string } {
  const bad = { ok: false as const, erro: `${c.label}: valor inválido.` };
  switch (c.kind) {
    case "texto":
    case "data":
      return typeof v === "string" ? { ok: true, value: v } : bad;
    case "sim_nao":
      if (typeof v === "boolean") return { ok: true, value: v ? "true" : "false" };
      if (typeof v === "string" && /^(true|false|sim|nao|não)$/i.test(v.trim())) return { ok: true, value: /^(true|sim)$/i.test(v.trim()) ? "true" : "false" };
      return bad;
    case "dinheiro":
      if (typeof v === "number") return Number.isFinite(v) ? { ok: true, value: v.toFixed(2).replace(".", ",") } : bad;
      return typeof v === "string" ? { ok: true, value: v } : bad;
    case "decimal":
    case "inteiro":
      if (typeof v === "number") return Number.isFinite(v) ? { ok: true, value: String(v) } : bad;
      return typeof v === "string" ? { ok: true, value: v.trim() } : bad;
    case "opcao": {
      if (typeof v !== "string") return bad;
      const k = matchOpcao(v, c.opcoes ?? {});
      return k ? { ok: true, value: k } : { ok: false, erro: `${c.label} inválido. Use: ${Object.keys(c.opcoes ?? {}).join(", ")}.` };
    }
    case "dias":
      return { ok: true, value: listOf(v).map(dia) };
    case "linhas":
      return { ok: true, value: listOf(v).map((x) => s(x)).join("\n") };
    case "pessoas": {
      const ids: string[] = [];
      for (const name of listOf(v)) {
        const q = s(name).trim();
        const m = EU.test(q) ? lk.me : matchByName(lk.members, q);
        if (!m) return { ok: false, erro: `Pessoa não encontrada no rodízio. Opções: ${lk.members.map((x) => x.name).join(", ")}.` };
        ids.push(m.id);
      }
      return { ok: true, value: ids };
    }
    case "pet": {
      if (typeof v !== "string") return bad;
      const p = matchByName(lk.pets, v);
      if (!p) return { ok: false, erro: lk.pets.length ? `Pet não encontrado. Opções: ${lk.pets.map((x) => x.name).join(", ")}.` : "Nenhum pet cadastrado." };
      return { ok: true, value: p.id };
    }
  }
}

/** Valor do formulário → texto do painel (sempre texto simples; o React escapa). */
function show(c: Campo, raw: Raw, lk: AlterarLookup): string | null {
  const v = raw[c.key];
  if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  switch (c.kind) {
    case "data":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? brDate(v) : str(raw, c.key);
    case "dinheiro": {
      const n = parseBRL(str(raw, c.key));
      return n === null ? str(raw, c.key) : formatBRL(n);
    }
    case "opcao":
      return c.opcoes?.[str(raw, c.key)] ?? str(raw, c.key);
    case "dias":
      return (Array.isArray(v) ? v : [v]).map((d) => WEEKDAYS[Number(d)] ?? d).join(", ");
    case "pessoas":
      return (Array.isArray(v) ? v : [v]).map((id) => lk.members.find((m) => m.id === id)?.name ?? "alguém que saiu da família").join(", ");
    case "linhas":
      return str(raw, c.key).split("\n").filter(Boolean).join(", ") || null;
    case "pet":
      return lk.pets.find((p) => p.id === v)?.name ?? "Pet";
    case "sim_nao":
      return v === "true" ? "Sim" : "Não";
    default:
      return str(raw, c.key);
  }
}

/* ---------- Seções (mesmos campos e validadores das telas) ---------- */

const TEXTO = (arg: string, key: string, label: string): Campo => ({ arg, key, label, kind: "texto" });
const DATA = (arg: string, key: string, label: string): Campo => ({ arg, key, label, kind: "data" });
const ownedRaw = (r: Row): Raw => ({ shared: on(r.shared) });
const onePet = (lk: AlterarLookup): Raw => (lk.pets.length === 1 ? { pet_id: lk.pets[0].id } : {});
const igrejaTitle = (r: Raw) => str(r, "title") || str(r, "body").slice(0, 60) || "Sem título";

const DONE_CAMPOS = (notas: string): Campo[] => [
  DATA("data", "done_on", "Feita em"),
  { arg: "custo", key: "cost", label: "Custo", kind: "dinheiro" },
  TEXTO(notas, "notes", "Observações"),
];
const showDone = (raw: Raw, lk: AlterarLookup, campos: Campo[]) =>
  campos.map((c) => ({ rotulo: c.label, antes: null, depois: show(c, raw, lk) })).filter((c) => c.depois !== null);

/** "Feita" com data (padrão hoje), custo e observação, como a tela; mostra a próxima data que vai ficar. */
function doneWithNext(
  validate: (raw: Raw, today: string) => { ok: true; value: { done_on: string } } | { ok: false; erro: string },
  next: (last: string, row: Row) => string | null,
  campos: Campo[],
  extra: (row: Row) => Raw = () => ({}),
) {
  return (row: Row, raw: Raw, lk: AlterarLookup) => {
    const r: Raw = { done_on: lk.today, ...raw };
    const v = validate(r, lk.today);
    if (!v.ok) return v;
    // Data antiga registrada depois não faz a "última vez" voltar no tempo (mesma regra das actions).
    const prev = typeof row.last_done_on === "string" ? row.last_done_on : null;
    const last = prev && prev > v.value.done_on ? prev : v.value.done_on;
    const nxt = next(last, row);
    const shown = showDone({ ...r, done_on: v.value.done_on }, lk, campos);
    return {
      ok: true as const,
      campos: [
        ...shown,
        { rotulo: "Próxima", antes: typeof row.next_due_on === "string" ? brDate(row.next_due_on) : null, depois: nxt ? brDate(nxt) : null },
      ],
      raw: { ...r, done_on: v.value.done_on, ...extra(row) },
    };
  };
}

const SPECS: Record<AlterarAba, Record<string, Spec>> = {
  casa: {
    tarefas: {
      aba: "casa",
      secao: "tarefas",
      rotulo: "Tarefa",
      table: "casa_chores",
      cols: "id, name, notes, frequency, weekdays, month_day, rotation, next_index, next_due_on, active",
      acoes: ["criar", "editar", "apagar", "concluir"],
      campos: [
        TEXTO("nome", "name", "Tarefa"),
        { arg: "frequencia", key: "frequency", label: "Frequência", kind: "opcao", opcoes: FREQ },
        { arg: "dias_semana", key: "weekdays", label: "Dias da semana", kind: "dias" },
        { arg: "dia_mes", key: "month_day", label: "Dia do mês", kind: "inteiro" },
        { arg: "rodizio", key: "rotation", label: "Rodízio", kind: "pessoas" },
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({
        name: s(r.name),
        notes: s(r.notes),
        frequency: s(r.frequency),
        weekdays: Array.isArray(r.weekdays) ? r.weekdays.map(String) : [],
        month_day: s(r.month_day),
        rotation: Array.isArray(r.rotation) ? r.rotation.map(String) : [],
      }),
      defaults: (lk): Raw => (lk.me ? { rotation: [lk.me.id] } : {}),
      validate: (raw, lk) => okv(validateChoreInput(raw, lk.members.map((m) => m.id))),
      titulo: (r) => str(r, "name"),
      concluir: {
        campos: [],
        // "Feita" da tela: avança rodízio e data a partir do estado atual.
        plan: (row, raw, lk) => {
          const valid = new Set(lk.members.map((m) => m.id));
          const rotation = Array.isArray(row.rotation) ? (row.rotation as string[]) : [];
          const resp = currentResponsible({ rotation, next_index: Number(row.next_index ?? 0) }, valid);
          const campos: AlteracaoCampo[] = [
            { rotulo: "Vez de", antes: null, depois: resp ? (lk.members.find((m) => m.id === resp)?.name ?? null) : null },
            { rotulo: "Prevista para", antes: null, depois: typeof row.next_due_on === "string" ? brDate(row.next_due_on) : null },
          ].filter((c) => c.depois !== null);
          return { ok: true, campos, raw };
        },
      },
    },
    compras: {
      aba: "casa",
      secao: "compras",
      rotulo: "Item de compra",
      table: "casa_shopping_items",
      cols: "id, name, quantity, unit, category, notes, done",
      acoes: ["criar", "editar", "apagar", "concluir"],
      campos: [
        TEXTO("nome", "name", "Item"),
        { arg: "quantidade", key: "quantity", label: "Quantidade", kind: "decimal" },
        TEXTO("unidade", "unit", "Unidade"),
        TEXTO("categoria", "category", "Categoria"),
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({ name: s(r.name), quantity: r.quantity == null ? "" : String(Number(r.quantity)), unit: s(r.unit), category: s(r.category), notes: s(r.notes) }),
      validate: (raw) => okv(validateShoppingInput(raw)),
      titulo: (r) => str(r, "name"),
      concluir: {
        // Marcar comprado (padrão) ou desmarcar, como o toque na lista da tela.
        campos: [{ arg: "comprado", key: "done", label: "Comprado", kind: "sim_nao" }],
        plan: (row, raw) => {
          const target = raw.done !== "false";
          if ((row.done === true) === target) return { ok: false, erro: target ? "Esse item já está marcado como comprado." : "Esse item já está pendente na lista." };
          const label = (d: boolean) => (d ? "Comprado" : "Pendente");
          return { ok: true, campos: [{ rotulo: "Situação", antes: label(!target), depois: label(target) }], raw: { done: target ? "true" : "false" } };
        },
      },
    },
    manutencao: {
      aba: "casa",
      secao: "manutencao",
      rotulo: "Manutenção",
      table: "casa_maintenance",
      cols: "id, name, notes, interval_value, interval_unit, last_done_on, next_due_on, provider, provider_id, active",
      acoes: ["criar", "editar", "apagar", "concluir"],
      campos: [
        TEXTO("nome", "name", "Manutenção"),
        { arg: "intervalo", key: "interval_value", label: "Intervalo", kind: "inteiro" },
        { arg: "unidade_intervalo", key: "interval_unit", label: "Unidade do intervalo", kind: "opcao", opcoes: UNIDADES_INTERVALO },
        DATA("ultima_vez", "last_done_on", "Última vez"),
        TEXTO("prestador", "provider", "Prestador"),
        TEXTO("notas", "notes", "Observações"),
      ],
      // provider_id fica como está (vínculo com o cadastro de prestadores só pela tela).
      rowToRaw: (r) => ({
        name: s(r.name),
        notes: s(r.notes),
        interval_value: s(r.interval_value),
        interval_unit: s(r.interval_unit),
        last_done_on: s(r.last_done_on),
        provider: s(r.provider),
        provider_id: s(r.provider_id),
      }),
      validate: (raw, lk) => okv(validateMaintenanceInput(raw, lk.today)),
      titulo: (r) => str(r, "name"),
      concluir: {
        campos: DONE_CAMPOS("notas"),
        plan: doneWithNext(validateMaintenanceDone, (last, row) => nextMaintenanceDue(last, Number(row.interval_value), row.interval_unit as IntervalUnit), DONE_CAMPOS("notas")),
      },
    },
    documentos: {
      aba: "casa",
      secao: "documentos",
      rotulo: "Documento",
      table: "casa_documents",
      cols: "id, kind, title, product, store, purchase_date, warranty_until, amount, notes, file_path",
      acoes: ["criar", "editar", "apagar"],
      campos: [
        { arg: "tipo", key: "kind", label: "Tipo", kind: "opcao", opcoes: DOC_KIND_LABEL },
        TEXTO("nome", "title", "Título"),
        TEXTO("produto", "product", "Produto"),
        TEXTO("loja", "store", "Loja"),
        DATA("data_compra", "purchase_date", "Data da compra"),
        DATA("garantia_ate", "warranty_until", "Garantia até"),
        { arg: "valor", key: "amount", label: "Valor", kind: "dinheiro" },
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({
        kind: s(r.kind),
        title: s(r.title),
        product: s(r.product),
        store: s(r.store),
        purchase_date: s(r.purchase_date),
        warranty_until: s(r.warranty_until),
        amount: r.amount == null ? "" : Number(r.amount).toFixed(2).replace(".", ","),
        notes: s(r.notes),
      }),
      defaults: () => ({ kind: "outro" }),
      validate: (raw) => okv(validateDocumentInput(raw)),
      titulo: (r) => str(r, "title"),
    },
    cardapio: {
      aba: "casa",
      secao: "cardapio",
      rotulo: "Refeição",
      table: "casa_meal_plan",
      cols: "id, day, meal, title, ingredients, notes",
      acoes: ["criar", "editar", "apagar"],
      campos: [
        DATA("dia", "day", "Dia"),
        { arg: "refeicao", key: "meal", label: "Refeição", kind: "opcao", opcoes: MEAL_LABEL },
        TEXTO("nome", "title", "Prato"),
        { arg: "ingredientes", key: "ingredients", label: "Ingredientes", kind: "linhas" },
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({ day: s(r.day), meal: s(r.meal), title: s(r.title), ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(String).join("\n") : "", notes: s(r.notes) }),
      validate: (raw) => okv(validateMealInput(raw)),
      titulo: (r) => str(r, "title"),
      // A tela grava por (dia, refeição): mudar o dia seria outra refeição.
      fixos: ["dia", "refeicao"],
    },
    prestadores: {
      aba: "casa",
      secao: "prestadores",
      rotulo: "Prestador",
      table: "casa_providers",
      cols: "id, name, service, phone, email, notes",
      acoes: ["criar", "editar", "apagar"],
      campos: [TEXTO("nome", "name", "Nome"), TEXTO("servico", "service", "Serviço"), TEXTO("telefone", "phone", "Telefone"), TEXTO("email", "email", "E-mail"), TEXTO("notas", "notes", "Observações")],
      rowToRaw: (r) => ({ name: s(r.name), service: s(r.service), phone: s(r.phone), email: s(r.email), notes: s(r.notes) }),
      validate: (raw) => okv(validateProviderInput(raw)),
      titulo: (r) => str(r, "name"),
    },
  },
  pet: {
    saude: {
      aba: "pet",
      secao: "saude",
      rotulo: "Registro de saúde do pet",
      table: "casa_pet_health",
      cols: "id, pet_id, kind, name, dose, applied_on, next_due_on, notes, file_path",
      acoes: ["criar", "editar", "apagar"],
      campos: [
        { arg: "pet", key: "pet_id", label: "Pet", kind: "pet" },
        { arg: "tipo", key: "kind", label: "Tipo", kind: "opcao", opcoes: PET_HEALTH_LABEL },
        TEXTO("nome", "name", "Nome"),
        TEXTO("dose", "dose", "Dose"),
        DATA("data", "applied_on", "Aplicada em"),
        DATA("proxima", "next_due_on", "Próxima dose"),
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({ pet_id: s(r.pet_id), kind: s(r.kind), name: s(r.name), dose: s(r.dose), applied_on: s(r.applied_on), next_due_on: s(r.next_due_on), notes: s(r.notes) }),
      defaults: (lk): Raw => (lk.pets.length === 1 ? { pet_id: lk.pets[0].id } : {}),
      validate: (raw) => okv(validatePetHealthInput(raw)),
      titulo: (r) => str(r, "name"),
    },
    veterinario: {
      aba: "pet",
      secao: "veterinario",
      rotulo: "Registro do veterinário",
      table: "casa_pet_vet",
      cols: "id, pet_id, kind, happened_on, clinic, vet, reason, notes, cost, file_path",
      acoes: ["criar", "editar", "apagar"],
      campos: [
        { arg: "pet", key: "pet_id", label: "Pet", kind: "pet" },
        { arg: "tipo", key: "kind", label: "Tipo", kind: "opcao", opcoes: PET_VET_LABEL },
        DATA("data", "happened_on", "Data"),
        TEXTO("motivo", "reason", "Motivo"),
        TEXTO("clinica", "clinic", "Clínica"),
        TEXTO("veterinario", "vet", "Veterinário"),
        { arg: "custo", key: "cost", label: "Custo", kind: "dinheiro" },
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({
        pet_id: s(r.pet_id),
        kind: s(r.kind),
        happened_on: s(r.happened_on),
        clinic: s(r.clinic),
        vet: s(r.vet),
        reason: s(r.reason),
        notes: s(r.notes),
        cost: r.cost == null ? "" : Number(r.cost).toFixed(2).replace(".", ","),
      }),
      defaults: (lk): Raw => (lk.pets.length === 1 ? { pet_id: lk.pets[0].id } : {}),
      validate: (raw) => okv(validatePetVetInput(raw)),
      titulo: (r) => str(r, "reason") || (PET_VET_LABEL as Record<string, string>)[str(r, "kind")] || "Veterinário",
    },
    cuidados: {
      aba: "pet",
      secao: "cuidados",
      rotulo: "Cuidado",
      table: "casa_pet_care",
      cols: "id, pet_id, name, interval_value, interval_unit, last_done_on, next_due_on, provider_id, active, notes",
      acoes: ["criar", "editar", "apagar", "concluir"],
      campos: [
        { arg: "pet", key: "pet_id", label: "Pet", kind: "pet" },
        TEXTO("nome", "name", "Cuidado"),
        { arg: "intervalo", key: "interval_value", label: "Intervalo", kind: "inteiro" },
        { arg: "unidade_intervalo", key: "interval_unit", label: "Unidade do intervalo", kind: "opcao", opcoes: { dias: "dias", semanas: "semanas", meses: "meses" } },
        DATA("ultima_vez", "last_done_on", "Última vez"),
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({
        pet_id: s(r.pet_id),
        name: s(r.name),
        interval_value: s(r.interval_value),
        interval_unit: s(r.interval_unit),
        last_done_on: s(r.last_done_on),
        provider_id: s(r.provider_id),
        notes: s(r.notes),
      }),
      defaults: (lk): Raw => (lk.pets.length === 1 ? { pet_id: lk.pets[0].id } : {}),
      validate: (raw, lk) => okv(validatePetCareInput(raw, lk.today)),
      titulo: (r) => str(r, "name"),
      concluir: {
        campos: DONE_CAMPOS("notas"),
        // Estado atual vai junto (expected_*): a action da tela não registra duas vezes se outro celular marcou antes.
        plan: doneWithNext(validatePetCareDone, (last, row) => nextCareDue(last, Number(row.interval_value), row.interval_unit as PetCareUnit), DONE_CAMPOS("notas"), (row) => ({
          expected_last: s(row.last_done_on),
          expected_next: s(row.next_due_on),
        })),
      },
    },
    peso: {
      aba: "pet",
      secao: "peso",
      rotulo: "Pesagem",
      table: "casa_pet_weights",
      cols: "id, pet_id, measured_on, weight_kg",
      // A tela não edita pesagem (registrar de novo no mesmo dia substitui).
      acoes: ["criar", "apagar"],
      campos: [{ arg: "pet", key: "pet_id", label: "Pet", kind: "pet" }, { arg: "peso_kg", key: "weight_kg", label: "Peso (kg)", kind: "decimal" }, DATA("data", "measured_on", "Data")],
      rowToRaw: (r) => ({ pet_id: s(r.pet_id), measured_on: s(r.measured_on), weight_kg: r.weight_kg == null ? "" : String(Number(r.weight_kg)) }),
      defaults: (lk) => ({ ...onePet(lk), measured_on: lk.today }),
      validate: (raw, lk) => okv(validatePetWeightInput(raw, lk.today)),
      titulo: (r) => `${str(r, "weight_kg").replace(".", ",")} kg`,
    },
    racao: {
      aba: "pet",
      secao: "racao",
      rotulo: "Ração",
      table: "casa_pet_food",
      cols: "id, pet_id, brand, bag_kg, daily_grams, started_on, active, notes",
      acoes: ["criar", "editar", "apagar"],
      campos: [
        { arg: "pet", key: "pet_id", label: "Pet", kind: "pet" },
        TEXTO("nome", "brand", "Ração"),
        { arg: "saco_kg", key: "bag_kg", label: "Saco (kg)", kind: "decimal" },
        { arg: "gramas_dia", key: "daily_grams", label: "Gramas por dia", kind: "inteiro" },
        DATA("data", "started_on", "Início"),
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({ pet_id: s(r.pet_id), brand: s(r.brand), bag_kg: r.bag_kg == null ? "" : String(Number(r.bag_kg)), daily_grams: s(r.daily_grams), started_on: s(r.started_on), notes: s(r.notes) }),
      defaults: (lk) => ({ ...onePet(lk), started_on: lk.today }),
      validate: (raw, lk) => okv(validatePetFoodInput(raw, lk.today)),
      titulo: (r) => str(r, "brand"),
    },
  },
  igreja: {
    palavras: {
      aba: "igreja",
      secao: "palavras",
      rotulo: "Anotação",
      table: "igreja_words",
      cols: "id, owner_id, shared, kind, title, body, received_on, reference, fulfilled_on",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [TEXTO("titulo", "title", "Título"), TEXTO("texto", "body", "Texto"), TEXTO("referencia", "reference", "Referência"), DATA("data", "received_on", "Data")],
      rowToRaw: (r) => ({ kind: s(r.kind), title: s(r.title), body: s(r.body), received_on: s(r.received_on), reference: s(r.reference), fulfilled_on: s(r.fulfilled_on), ...ownedRaw(r) }),
      defaults: () => ({ kind: "anotacao" }),
      validate: (raw, lk) => okv(validateWordInput(raw, lk.today)),
      titulo: igrejaTitle,
      acrescentar: "body",
      dono: true,
      rowOk: (r) => (r.kind === "anotacao" ? null : "Esse item é uma promessa: use a seção promessas."),
    },
    promessas: {
      aba: "igreja",
      secao: "promessas",
      rotulo: "Promessa",
      table: "igreja_words",
      cols: "id, owner_id, shared, kind, title, body, received_on, reference, fulfilled_on",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [
        TEXTO("titulo", "title", "Título"),
        TEXTO("texto", "body", "Texto"),
        TEXTO("referencia", "reference", "Referência"),
        DATA("data", "received_on", "Data"),
        DATA("cumprida_em", "fulfilled_on", "Cumprida em"),
      ],
      rowToRaw: (r) => ({ kind: s(r.kind), title: s(r.title), body: s(r.body), received_on: s(r.received_on), reference: s(r.reference), fulfilled_on: s(r.fulfilled_on), ...ownedRaw(r) }),
      defaults: () => ({ kind: "promessa" }),
      validate: (raw, lk) => okv(validateWordInput(raw, lk.today)),
      titulo: igrejaTitle,
      acrescentar: "body",
      dono: true,
      rowOk: (r) => (r.kind === "promessa" ? null : "Esse item é uma anotação: use a seção palavras."),
    },
    oracoes: {
      aba: "igreja",
      secao: "oracoes",
      rotulo: "Oração",
      table: "igreja_prayers",
      cols: "id, owner_id, shared, title, person, details, status, answered_on, answer_notes",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [
        TEXTO("titulo", "title", "Motivo"),
        TEXTO("pessoa", "person", "Por quem"),
        TEXTO("texto", "details", "Detalhes"),
        { arg: "situacao", key: "status", label: "Situação", kind: "opcao", opcoes: { orando: "Orando", respondida: "Respondida" } },
        TEXTO("testemunho", "answer_notes", "Testemunho"),
      ],
      rowToRaw: (r) => ({ title: s(r.title), person: s(r.person), details: s(r.details), status: s(r.status), answered_on: s(r.answered_on), answer_notes: s(r.answer_notes), ...ownedRaw(r) }),
      validate: (raw, lk) => okv(validatePrayerInput(raw, lk.today)),
      titulo: (r) => str(r, "title"),
      acrescentar: "details",
      dono: true,
    },
    propositos: {
      aba: "igreja",
      secao: "propositos",
      rotulo: "Propósito",
      table: "igreja_purposes",
      cols: "id, owner_id, shared, title, description, status, starts_on, ends_on, notes",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [
        TEXTO("titulo", "title", "Propósito"),
        TEXTO("texto", "description", "Descrição"),
        { arg: "situacao", key: "status", label: "Situação", kind: "opcao", opcoes: PURPOSE_STATUS_LABEL },
        DATA("inicio", "starts_on", "Início"),
        DATA("fim", "ends_on", "Término"),
        TEXTO("anotacoes", "notes", "Anotações"),
      ],
      rowToRaw: (r) => ({ title: s(r.title), description: s(r.description), status: s(r.status), starts_on: s(r.starts_on), ends_on: s(r.ends_on), notes: s(r.notes), ...ownedRaw(r) }),
      validate: (raw) => okv(validatePurposeInput(raw)),
      titulo: (r) => str(r, "title"),
      acrescentar: "notes",
      dono: true,
    },
    carisma: {
      aba: "igreja",
      secao: "carisma",
      rotulo: "Aula do Carisma",
      table: "igreja_carisma_lessons",
      cols: "id, owner_id, shared, title, lesson_date, subject, teacher, notes, drive_folder_id",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [
        TEXTO("titulo", "title", "Título"),
        DATA("data", "lesson_date", "Data da aula"),
        TEXTO("materia", "subject", "Matéria"),
        TEXTO("professor", "teacher", "Professor"),
        TEXTO("anotacoes", "notes", "Anotações"),
      ],
      rowToRaw: (r) => ({ title: s(r.title), lesson_date: s(r.lesson_date), subject: s(r.subject), teacher: s(r.teacher), notes: s(r.notes) }),
      validate: (raw) => okv(validateLessonInput(raw)),
      titulo: (r) => str(r, "title"),
      acrescentar: "notes",
      dono: true,
    },
  },
};

export function specFor(aba: AlterarAba, secao: string): Spec | null {
  return SPECS[aba]?.[secao] ?? null;
}

export const SECOES_ALTERAR: Record<AlterarAba, readonly string[]> = { casa: CASA_ALTERAR, pet: PET_ALTERAR, igreja: IGREJA_ALTERAR };

/** Args aceitos por aba (para a declaração da ferramenta). */
export function argsDaAba(aba: AlterarAba): string[] {
  return [...new Set(Object.values(SPECS[aba]).flatMap((sp) => [...sp.campos, ...(sp.concluir?.campos ?? [])].map((c) => c.arg)))];
}

/* ---------- Argumentos do modelo ---------- */

export type AlterarArgs = {
  aba: AlterarAba;
  acao: AlterarAcao;
  secao: string;
  id: string | null;
  frase: string | null;
  valores: Record<string, unknown>;
};

const FIXED_KEYS = new Set(["acao", "secao", "id", "frase"]);
const present = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

function simpleValue(v: unknown): boolean {
  if (typeof v === "string") return v.length <= MAX_ARG_TEXT;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length <= 31 && v.every((x) => (typeof x === "string" && x.length <= 200) || (typeof x === "number" && Number.isFinite(x)));
  return false;
}

/** alterar_casa/alterar_pet/alterar_igreja: ação e seção conhecidas, id para o que mexe num item, só campos da seção. */
export function parseAlterarArgs(aba: unknown, args: unknown): { ok: true; value: AlterarArgs } | { ok: false; erro: string } {
  if (aba !== "casa" && aba !== "pet" && aba !== "igreja") return { ok: false, erro: "Aba inválida." };
  const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const acao = typeof a.acao === "string" ? normalizeName(a.acao) : "";
  if (!(ALTERAR_ACOES as readonly string[]).includes(acao)) return { ok: false, erro: `Ação inválida. Use: ${ALTERAR_ACOES.join(", ")}.` };
  const secaoRaw = typeof a.secao === "string" ? normalizeName(a.secao).replace(/[\s-]+/g, "_") : "";
  const spec = specFor(aba, secaoRaw);
  if (!spec) return { ok: false, erro: `Seção inválida. Use: ${SECOES_ALTERAR[aba].join(", ")}.` };
  const act = acao as AlterarAcao;
  if (!spec.acoes.includes(act)) return { ok: false, erro: `Em ${spec.secao} dá para: ${spec.acoes.join(", ")}.` };

  let id: string | null = null;
  if (act === "criar") {
    if (present(a.id)) return { ok: false, erro: "Para criar não use id." };
  } else {
    if (typeof a.id !== "string" || !UUID_RE.test(a.id.trim())) return { ok: false, erro: "Informe o id do item (use a consulta da aba para achar)." };
    id = a.id.trim().toLowerCase();
  }

  let frase: string | null = null;
  if (act === "acrescentar") {
    if (typeof a.frase !== "string" || !a.frase.trim()) return { ok: false, erro: "Informe a frase a acrescentar." };
    frase = a.frase.replace(/\r\n?/g, "\n").trim();
    if (frase.length > MAX_FRASE) return { ok: false, erro: `Frase muito longa (máximo ${MAX_FRASE}).` };
  }

  const allowed = new Set((act === "concluir" ? (spec.concluir?.campos ?? []) : spec.campos).map((c) => c.arg));
  const valores: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (FIXED_KEYS.has(k) || !present(v)) continue;
    if (!allowed.has(k)) return { ok: false, erro: `Campo ${k} não existe em ${spec.secao}. Campos: ${[...allowed].join(", ")}.` };
    if (!simpleValue(v)) return { ok: false, erro: `Campo ${k} inválido.` };
    valores[k] = v;
  }
  if ((act === "apagar" || act === "acrescentar") && Object.keys(valores).length > 0)
    return { ok: false, erro: `Para ${act}, mande só o id${act === "acrescentar" ? " e a frase" : ""}.` };
  if (act === "editar" && Object.keys(valores).length === 0) return { ok: false, erro: "Diga o que mudar." };
  return { ok: true, value: { aba, acao: act, secao: spec.secao, id, frase, valores } };
}

/** Forma plana dos args (vai no painel e volta no Confirmar, onde é validada de novo). */
export function flatArgs(a: AlterarArgs): Record<string, unknown> {
  return { acao: a.acao, secao: a.secao, ...(a.id ? { id: a.id } : {}), ...(a.frase ? { frase: a.frase } : {}), ...a.valores };
}

/* ---------- Plano + painel ---------- */

export type AlteracaoCampo = { rotulo: string; antes: string | null; depois: string | null };
export type AlteracaoPreview = {
  aba: AlterarAba;
  secao: string;
  acao: AlterarAcao;
  id: string | null;
  rotulo: string;
  titulo: string;
  campos: AlteracaoCampo[];
  /** "acrescentar": texto atual (mantido) e a frase nova. */
  anexo: { atual: string | null; acrescimo: string } | null;
  aviso: string | null;
  /** Args validados; o Confirmar valida de novo e recalcula tudo a partir do banco. */
  args: Record<string, unknown>;
};

export type AlteracaoPlan = { preview: AlteracaoPreview; raw: Raw; spec: Spec };
type PlanResult = { ok: true; plan: AlteracaoPlan } | { ok: false; erro: string };

/** De quem é o item da Igreja, para a mensagem de recusa. */
function donoNome(row: Row, lk: AlterarLookup) {
  return lk.members.find((m) => m.user_id === row.owner_id)?.name ?? "outra pessoa da família";
}

export const NAO_E_SEU = (nome: string) => `Esse item é de ${nome} (compartilhado com você): só quem criou pode alterar ou apagar.`;

/**
 * Monta o plano: valores finais do formulário (raw) e o painel. `row` é a linha atual (do banco, pela sessão),
 * obrigatória para editar/apagar/concluir/acrescentar. Sem adivinhar: nome ambíguo ou campo inválido vira erro.
 */
export function planAlteracao(a: AlterarArgs, row: Row | null, lk: AlterarLookup): PlanResult {
  const spec = specFor(a.aba, a.secao);
  if (!spec) return { ok: false, erro: "Seção inválida." };
  if (a.acao !== "criar") {
    if (!row) return { ok: false, erro: `${spec.rotulo} não encontrada(o).` };
    const bad = spec.rowOk?.(row);
    if (bad) return { ok: false, erro: bad };
    if (spec.dono && !canEdit({ owner_id: s(row.owner_id), shared: row.shared === true }, lk.uid)) return { ok: false, erro: NAO_E_SEU(donoNome(row, lk)) };
  }
  const base: Raw = a.acao === "criar" ? (spec.defaults?.(lk) ?? {}) : spec.rowToRaw(row!);
  const raw: Raw = { ...base };
  const preview = (campos: AlteracaoCampo[], anexo: AlteracaoPreview["anexo"] = null): AlteracaoPreview => ({
    aba: a.aba,
    secao: spec.secao,
    acao: a.acao,
    id: a.id,
    rotulo: spec.rotulo,
    titulo: spec.titulo(raw) || spec.rotulo,
    campos,
    anexo,
    aviso: null,
    args: flatArgs(a),
  });

  if (a.acao === "apagar") {
    const campos = spec.campos.map((c) => ({ rotulo: c.label, antes: show(c, raw, lk), depois: null })).filter((c) => c.antes !== null);
    return { ok: true, plan: { preview: preview(campos), raw, spec } };
  }

  if (a.acao === "concluir") {
    const cfg = spec.concluir!;
    const done: Raw = {};
    for (const c of cfg.campos) {
      if (!(c.arg in a.valores)) continue;
      const conv = toForm(c, a.valores[c.arg], lk);
      if (!conv.ok) return conv;
      done[c.key] = conv.value;
    }
    const r = cfg.plan(row!, done, lk);
    if (!r.ok) return r;
    // raw = só os campos do "Feita" (a linha atual fica como está; a action da tela recalcula a próxima data).
    const p = preview(r.campos);
    return { ok: true, plan: { preview: p, raw: r.raw, spec } };
  }

  if (a.acao === "acrescentar") {
    const key = spec.acrescentar!;
    const atual = str(raw, key);
    // Junta numa linha nova; o texto atual nunca é apagado nem reescrito.
    raw[key] = atual.trimEnd() ? `${atual.trimEnd()}\n${a.frase}` : a.frase!;
    const v = spec.validate(raw, lk);
    if (!v.ok) return v;
    return { ok: true, plan: { preview: preview([], { atual: atual || null, acrescimo: a.frase! }), raw, spec } };
  }

  // criar / editar
  for (const c of spec.campos) {
    if (!(c.arg in a.valores)) continue;
    const conv = toForm(c, a.valores[c.arg], lk);
    if (!conv.ok) return conv;
    if (a.acao === "editar" && spec.fixos?.includes(c.arg) && JSON.stringify(conv.value) !== JSON.stringify(base[c.key] ?? "")) {
      return { ok: false, erro: `${c.label} não muda na edição: apague e crie de novo.` };
    }
    raw[c.key] = conv.value;
  }
  if (spec.aba === "pet" && !raw.pet_id) {
    return { ok: false, erro: lk.pets.length ? `Pergunte de qual pet. Opções: ${lk.pets.map((x) => x.name).join(", ")}.` : "Nenhum pet cadastrado." };
  }
  const v = spec.validate(raw, lk);
  if (!v.ok) return v;
  if (a.acao === "criar") {
    const campos = spec.campos.map((c) => ({ rotulo: c.label, antes: null, depois: show(c, raw, lk) })).filter((c) => c.depois !== null);
    return { ok: true, plan: { preview: preview(campos), raw, spec } };
  }
  const campos = spec.campos
    .map((c) => ({ rotulo: c.label, antes: show(c, base, lk), depois: show(c, raw, lk) }))
    .filter((c) => c.antes !== c.depois);
  if (campos.length === 0) return { ok: false, erro: "Nada muda: os valores já são esses." };
  return { ok: true, plan: { preview: preview(campos), raw, spec } };
}

/** O que o usuário viu: no Confirmar, o painel recalculado do banco precisa ser igual ao mostrado. */
export function previewFingerprint(p: Pick<AlteracaoPreview, "aba" | "secao" | "acao" | "id" | "titulo" | "campos" | "anexo" | "aviso">): string {
  return JSON.stringify([p.aba, p.secao, p.acao, p.id, p.titulo, p.campos, p.anexo, p.aviso]);
}

/** Formulário da tela a partir do plano (listas viram campos repetidos, como os checkboxes). */
export function planToFormEntries(plan: AlteracaoPlan): [string, string][] {
  const out: [string, string][] = [];
  if (plan.preview.id && plan.preview.acao !== "criar") out.push(["id", plan.preview.id]);
  for (const [k, v] of Object.entries(plan.raw)) {
    if (Array.isArray(v)) for (const x of v) out.push([k, x]);
    else out.push([k, v]);
  }
  return out;
}

export const ITEM_MUDOU = "O item mudou desde que o Oli mostrou o painel. Nada foi gravado: peça de novo para conferir.";

export const ALTERAR_DONE: Record<AlterarAcao, string> = {
  criar: "Salvo.",
  editar: "Alteração salva.",
  apagar: "Apagado.",
  concluir: "Registrado.",
  acrescentar: "Frase acrescentada.",
};

export const ALTERAR_STATUS: Record<AlterarAcao, string> = {
  criar: "criado",
  editar: "alterado",
  apagar: "apagado",
  concluir: "concluido",
  acrescentar: "acrescentado",
};
