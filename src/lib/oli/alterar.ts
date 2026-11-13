/**
 * Escrita do Oli nas abas Casa, Pet, Igreja (etapa 2) e Saúde, Agenda e Finanças (etapa 3). Funções PURAS: validam os argumentos do modelo,
 * montam os valores do formulário da tela (mesmas chaves dos <input name>) e o painel de confirmação.
 * Nada é gravado aqui: a gravação acontece no Confirmar, pelas server actions das próprias telas, com os
 * valores recalculados no servidor a partir do banco (o cliente não é confiável).
 */
import { brDate, toSpDate, toSpLocal } from "@/lib/agenda/dates";
import { validateEventInput } from "@/lib/agenda/input";
import { txPayConflict, validateOneOffInput } from "@/lib/financas/avulsas";
import { formatBRL, parseBRL } from "@/lib/financas/money";
import { monthLabel } from "@/lib/financas/period";
import { MAX_AMOUNT, UUID_RE, validDate, validateManualTransaction } from "@/lib/financas/transaction-input";
import {
  endDateFor,
  KIND_LABEL,
  STATUS_LABEL,
  validateAppointmentInput,
  validateCardInput,
  validateExamInput,
  validateMedicationInput,
  validateProcedureInput,
  validateVaccineInput,
} from "@/lib/saude/input";
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
export type AlterarAba = "casa" | "pet" | "igreja" | "saude" | "agenda" | "financas";

export const CASA_ALTERAR = ["tarefas", "compras", "manutencao", "documentos", "cardapio", "prestadores"] as const;
export const PET_ALTERAR = ["saude", "veterinario", "cuidados", "peso", "racao"] as const;
export const IGREJA_ALTERAR = ["palavras", "promessas", "oracoes", "propositos", "carisma"] as const;
export const SAUDE_ALTERAR = ["consultas", "exames", "vacinas", "procedimentos", "medicamentos", "carteirinhas"] as const;
export const AGENDA_ALTERAR = ["eventos"] as const;
export const FINANCAS_ALTERAR = ["contas_fixas", "contas_avulsas", "metas", "orcamento", "lancamentos"] as const;
export const ABAS_ALTERAR = ["casa", "pet", "igreja", "saude", "agenda", "financas"] as const;

/** Origens de lançamento que o Oli pode editar/apagar (as telas as editam). Open Finance e qualquer origem nova ficam de fora. */
export const ORIGENS_EDITAVEIS = ["manual", "ofx", "csv", "documento"] as const;
export const OPEN_FINANCE_RECUSA = "Esse lançamento veio do Open Finance (banco): o Oli não edita nem apaga lançamento do banco. Se precisar, faça pela tela de Finanças.";
export const ORIGEM_DESCONHECIDA = "Não consegui confirmar a origem desse lançamento, então o Oli não altera nem apaga. Use a tela de Finanças.";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Tamanho máximo de um texto vindo do modelo (o validador da tela aplica o limite exato de cada campo). */
export const MAX_ARG_TEXT = 10_000;
/** Frase acrescentada a uma anotação. */
export const MAX_FRASE = 2000;

/** Valores no formato do formulário da tela (strings; listas para campos repetidos). */
export type Raw = Record<string, string | string[]>;
export type Row = Record<string, unknown>;

type Kind =
  | "texto"
  | "data"
  | "dinheiro"
  | "decimal"
  | "inteiro"
  | "opcao"
  | "dias"
  | "pessoas"
  | "linhas"
  | "pet"
  | "sim_nao"
  | "pessoa1"
  | "datahora"
  | "marca"
  | "horas"
  | "conta"
  | "categoria"
  | "agenda";
type Campo = { arg: string; key: string; label: string; kind: Kind; opcoes?: Record<string, string> };

type TxRef = { id: string; date: string; amount: number; description: string };
type TxUses = { fixed: { bill_id: string; month: string }[]; oneOff: { id: string }[] };

/** Dados lidos do banco pelo servidor (sessão/RLS) que as regras puras precisam; ausente = não deu para conferir. */
export type AlterarExtra = {
  /** Agenda: o evento é de uma agenda minha e gravável? */
  evento?: { editavel: boolean; dono: string };
  /** Finanças, "marcar paga"/"desfazer": estado atual do pagamento e do lançamento escolhido. */
  pag?: {
    /** Conta fixa: mês consultado (AAAA-MM); avulsa: null. */
    mes: string | null;
    pagamento: { id: string; auto: boolean; paid_on: string; amount: number } | null;
    tx: TxRef | null;
    usos: TxUses;
  };
};

export type AlterarLookup = {
  uid: string;
  me: { id: string; name: string } | null;
  members: { id: string; name: string; user_id: string | null }[];
  pets: { id: string; name: string }[];
  today: string;
  /** Finanças: contas bancárias ativas e categorias da família. */
  accounts?: { id: string; name: string }[];
  categories?: { id: string; name: string; kind: string }[];
  /** Agenda: agendas minhas onde posso gravar. */
  calendars?: { id: string; summary: string; primary: boolean }[];
  extra?: AlterarExtra;
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
  titulo: (raw: Raw, lk?: AlterarLookup) => string;
  /** Campo do formulário que recebe a frase em "acrescentar" (o texto atual é mantido). */
  acrescentar?: string;
  /** Igreja: só o dono altera ou apaga (item compartilhado pelo cônjuge não). */
  dono?: boolean;
  /** Args que não mudam na edição (a tela não permite). */
  fixos?: string[];
  /** Filtro da linha (palavra x promessa na mesma tabela; origem do lançamento; dono do evento). */
  rowOk?: (row: Row, lk: AlterarLookup) => string | null;
  /** O item não tem id próprio na conversa (orçamento): é achado pela categoria; criar/editar/apagar sem id. */
  semId?: boolean;
  /** Acerta valores derivados do raw (orçamento: mês só vale com escopo "mes"). Roda depois dos padrões/linha e depois dos args. */
  ajustar?: (raw: Raw, lk: AlterarLookup) => void;
  /** Chaves que não entram no painel (ex.: o mês de um orçamento de todos os meses). */
  ocultar?: (raw: Raw) => string[];
  /** Formulário da tela quando as chaves do raw não são as dos <input name> (evento). */
  formEntries?: (raw: Raw) => [string, string][];
  /** "concluir": o "Feita"/"Comprado" da tela. Campos próprios (data, custo...) e o painel a partir da linha atual. */
  concluir?: {
    campos: Campo[];
    plan: (row: Row, raw: Raw, lk: AlterarLookup) => { ok: true; campos: AlteracaoCampo[]; raw: Raw; aviso?: string | null } | { ok: false; erro: string };
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
    case "marca":
      if (typeof v === "boolean") return { ok: true, value: v ? "on" : "" };
      if (typeof v === "string" && /^(true|false|sim|nao|não)$/i.test(v.trim())) return { ok: true, value: /^(true|sim)$/i.test(v.trim()) ? "on" : "" };
      return bad;
    case "datahora":
      return typeof v === "string" ? { ok: true, value: v.trim() } : bad;
    case "horas":
      return { ok: true, value: listOf(v).map((x) => s(x).trim()).filter(Boolean) };
    case "pessoa1": {
      if (typeof v !== "string") return bad;
      const m = EU.test(v.trim()) ? lk.me : matchByName(lk.members, v);
      if (!m) return { ok: false, erro: `Pessoa não encontrada ou ambígua. Opções: ${lk.members.map((x) => x.name).join(", ")}.` };
      return { ok: true, value: m.id };
    }
    case "conta":
    case "categoria":
    case "agenda": {
      if (typeof v !== "string") return bad;
      const list =
        c.kind === "conta" ? (lk.accounts ?? []) : c.kind === "categoria" ? (lk.categories ?? []) : (lk.calendars ?? []).map((x) => ({ id: x.id, name: x.summary }));
      const m = matchByName(list, v);
      if (!m) return { ok: false, erro: `${c.label} não encontrada(o) ou ambígua(o). Opções: ${list.map((x) => x.name).join(", ") || "nenhuma"}.` };
      return { ok: true, value: m.id };
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
  // Caixa de marcar: "" (desmarcada) só aparece se o campo existe no formulário (edição); criar sem o campo não mostra.
  if (c.kind === "marca") return v === undefined ? null : v === "on" ? "Sim" : "Não";
  if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  switch (c.kind) {
    case "datahora": {
      const t = str(raw, c.key);
      return t.length > 10 ? `${brDate(t.slice(0, 10))} ${t.slice(11)}` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? brDate(t) : t;
    }
    case "horas":
      return (Array.isArray(v) ? v : [v]).join(", ");
    case "pessoa1":
      return lk.members.find((m) => m.id === v)?.name ?? "alguém que saiu da família";
    case "conta":
      return lk.accounts?.find((x) => x.id === v)?.name ?? "Conta";
    case "categoria":
      return lk.categories?.find((x) => x.id === v)?.name ?? "Categoria";
    case "agenda":
      return lk.calendars?.find((x) => x.id === v)?.summary ?? "Agenda";
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


/* ---------- Saúde, Agenda e Finanças (etapa 3): ajudantes ---------- */

const PESSOA: Campo = { arg: "pessoa", key: "member_id", label: "Pessoa", kind: "pessoa1" };
const DINHEIRO = (arg: string, key: string, label: string): Campo => ({ arg, key, label, kind: "dinheiro" });
const money = (v: unknown) => (v === null || v === undefined || v === "" ? "" : Number(v).toFixed(2).replace(".", ","));
/** Com uma só pessoa na família, é ela; com mais de uma, o Oli precisa perguntar (nada de chutar). */
const soUm = (lk: AlterarLookup): Raw => (lk.members.length === 1 ? { member_id: lk.members[0].id } : {});

function saudeValidate(raw: Raw, lk: AlterarLookup, fn: (raw: Record<string, unknown>, memberIds: string[]) => { ok: boolean; erro?: string }): Check {
  if (!str(raw, "member_id")) return { ok: false, erro: `Pergunte para quem é. Opções: ${lk.members.map((m) => m.name).join(", ")}.` };
  return okv(fn(raw, lk.members.map((m) => m.id)));
}

/** Mesmas regras de saveBill (planning-actions.ts); o Confirmar roda a action, que valida de novo. */
function validarContaFixa(raw: Raw, lk: AlterarLookup): Check {
  const name = str(raw, "name").trim();
  const amount = parseBRL(str(raw, "amount"));
  const dueDay = Number(str(raw, "due_day"));
  if (!name || name.length > 60) return { ok: false, erro: "Dê um nome à conta (até 60 letras)." };
  if (amount === null || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, erro: "Valor inválido." };
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return { ok: false, erro: "Dia de vencimento entre 1 e 31." };
  if (str(raw, "account_id") && !lk.accounts?.some((a) => a.id === str(raw, "account_id"))) return { ok: false, erro: "Conta bancária não encontrada." };
  return { ok: true };
}

/** Mesmas regras de saveGoal. */
function validarMeta(raw: Raw, lk: AlterarLookup): Check {
  const name = str(raw, "name").trim();
  const target = parseBRL(str(raw, "target"));
  const date = str(raw, "target_date");
  if (!name || name.length > 60) return { ok: false, erro: "Dê um nome à meta (até 60 letras)." };
  if (target === null || target <= 0 || target > 100_000_000) return { ok: false, erro: "Valor da meta inválido." };
  if (date && !validDate(date)) return { ok: false, erro: "Data inválida." };
  if (!str(raw, "account_id")) return { ok: false, erro: `Pergunte em qual conta o dinheiro da meta fica guardado. Opções: ${(lk.accounts ?? []).map((a) => a.name).join(", ")}.` };
  return { ok: true };
}

/** Mesmas regras de saveBudget: valor 0 a 10 milhões, só categoria de despesa, mês AAAA-MM. */
function validarOrcamento(raw: Raw, lk: AlterarLookup): Check {
  const cat = lk.categories?.find((c) => c.id === str(raw, "category_id"));
  if (!cat) return { ok: false, erro: "Categoria inválida." };
  if (cat.kind !== "despesa") return { ok: false, erro: "Orçamento só vale para categorias de despesa." };
  if (!MONTH_RE.test(str(raw, "month"))) return { ok: false, erro: "Mês inválido. Use AAAA-MM." };
  const amount = parseBRL(str(raw, "amount"));
  if (amount === null || amount < 0 || amount > MAX_AMOUNT) return { ok: false, erro: "Valor inválido." };
  return { ok: true };
}

/** validateManualTransaction (a mesma da tela e do criar_lancamento) + a regra categoria x direção do formulário. */
function validarLancamento(raw: Raw, lk: AlterarLookup): Check {
  if (!str(raw, "account_id")) return { ok: false, erro: `Pergunte em qual conta é. Opções: ${(lk.accounts ?? []).map((a) => a.name).join(", ")}.` };
  if (!lk.accounts?.some((a) => a.id === str(raw, "account_id"))) return { ok: false, erro: "Conta não encontrada." };
  const notes = str(raw, "notes");
  if (notes.length > 500) return { ok: false, erro: "Observações muito longas (máximo 500)." };
  // O sinal vem só do tipo (entrada/saída), como no formulário: valor negativo é ambíguo e não é convertido.
  const valorBruto = parseBRL(str(raw, "amount"));
  if (valorBruto !== null && valorBruto < 0) return { ok: false, erro: "Valor inválido." };
  const v = validateManualTransaction({
    accountId: str(raw, "account_id"),
    description: str(raw, "description"),
    value: parseBRL(str(raw, "amount")),
    date: str(raw, "date"),
    direction: str(raw, "direction"),
    categoryId: str(raw, "category_id"),
    memberId: str(raw, "member_id"),
    notes,
  });
  if ("error" in v) return { ok: false, erro: v.error ?? "Dados inválidos." };
  const catId = str(raw, "category_id");
  if (catId) {
    const cat = lk.categories?.find((c) => c.id === catId);
    if (!cat) return { ok: false, erro: "Categoria não encontrada." };
    const entrada = str(raw, "direction") === "entrada";
    if (cat.kind === "receita" && !entrada) return { ok: false, erro: `A categoria ${cat.name} é de receita: o lançamento tem que ser uma Entrada.` };
    if (cat.kind === "despesa" && entrada) return { ok: false, erro: `A categoria ${cat.name} é de despesa: o lançamento tem que ser uma Saída.` };
  }
  return { ok: true };
}

const CONFERIR_FALHOU = "Não consegui conferir o pagamento agora. Nada foi alterado: tente de novo.";

/**
 * "Marcar paga" / "desfazer pagamento" de conta fixa (um mês) ou avulsa. O estado atual (pagamento, lançamento
 * escolhido e onde ele já está ligado) vem do servidor em lk.extra.pag; sem ele, recusa.
 * Um lançamento não paga conta fixa e avulsa ao mesmo tempo (txPayConflict, a regra da tela).
 */
function planPagamento(tipo: "fixa" | "avulsa", row: Row, raw: Raw, lk: AlterarLookup) {
  const erro = (e: string) => ({ ok: false as const, erro: e });
  const nome = s(row.name);
  const pag = lk.extra?.pag;
  const desfazer = raw.pago === "false";
  let mes: string | null = null;
  if (tipo === "fixa") {
    mes = str(raw, "month") || lk.today.slice(0, 7);
    if (!MONTH_RE.test(mes)) return erro("Mês inválido. Use AAAA-MM.");
  }
  if (!pag || pag.mes !== mes) return erro(CONFERIR_FALHOU);
  const quando = mes ? ` em ${monthLabel(mes)}` : "";

  const atual = tipo === "fixa" ? pag.pagamento : row.paid_on ? { id: s(row.id), auto: row.paid_auto === true, paid_on: s(row.paid_on), amount: Number(row.amount) } : null;
  if (desfazer) {
    if (!atual) return erro(`${nome} não tem pagamento registrado${quando}.`);
    const campos: AlteracaoCampo[] = [
      ...(mes ? [{ rotulo: "Mês", antes: null, depois: monthLabel(mes) }] : []),
      { rotulo: "Situação", antes: "Paga", depois: "Em aberto" },
      { rotulo: "Pagamento desfeito", antes: null, depois: `${formatBRL(atual.amount)} em ${brDate(atual.paid_on)}` },
    ];
    return {
      ok: true as const,
      campos,
      raw: { desfazer: "true", id: atual.id, month: mes ?? "", auto: atual.auto ? "true" : "false" } as Raw,
      aviso: desfazerAviso(nome, mes ? monthLabel(mes) : null, atual.auto),
    };
  }
  if (atual) return erro(`${nome} já está paga${quando}. Para trocar, desfaça o pagamento antes.`);

  const txId = str(raw, "transaction_id");
  let tx: TxRef | null = null;
  if (txId) {
    if (!UUID_RE.test(txId)) return erro("Lançamento inválido: use o id que veio da consulta.");
    tx = pag.tx;
    if (!tx || tx.id !== txId.toLowerCase()) return erro("Lançamento não encontrado nesta família.");
    if (tx.amount >= 0) return erro("Escolha um lançamento de saída desta família.");
    const conflito = txPayConflict(tipo === "fixa" ? { kind: "fixa", billId: s(row.id), month: mes! } : { kind: "avulsa", id: s(row.id) }, pag.usos);
    if (conflito) return erro(conflito);
  }
  const pagoEm = str(raw, "paid_on") || (tx ? tx.date : lk.today);
  const valor = str(raw, "amount") || money(row.amount);
  if (!tx) {
    if (!validDate(pagoEm)) return erro("Data do pagamento inválida.");
    if (tipo === "fixa") {
      const v = parseBRL(valor);
      if (v === null || v <= 0 || v > MAX_AMOUNT) return erro("Valor pago inválido.");
    }
  }
  const campos: AlteracaoCampo[] = [
    ...(mes ? [{ rotulo: "Mês", antes: null, depois: monthLabel(mes) }] : []),
    { rotulo: "Situação", antes: "Em aberto", depois: "Paga" },
    tx
      ? { rotulo: "Lançamento", antes: null, depois: `${tx.description} · ${formatBRL(Math.abs(tx.amount))} · ${brDate(tx.date)}` }
      : { rotulo: "Pago em", antes: null, depois: brDate(pagoEm) },
    ...(!tx && tipo === "fixa" ? [{ rotulo: "Valor pago", antes: null, depois: formatBRL(parseBRL(valor)!) }] : []),
  ];
  return {
    ok: true as const,
    campos,
    raw: { desfazer: "false", id: s(row.id), month: mes ?? "", transaction_id: tx ? tx.id : "sem", paid_on: pagoEm, amount: valor } as Raw,
    aviso: null,
  };
}

/** Aviso (alerta vermelho) de desfazer pagamento. */
export function desfazerAviso(nome: string, mesRotulo: string | null, auto: boolean): string {
  const base = `Desfazer o pagamento de ${nome}${mesRotulo ? ` em ${mesRotulo}` : ""}: a conta volta a ficar em aberto.`;
  const auto2 = auto ? " Foi uma baixa automática pelo extrato: o app guarda a recusa e não refaz essa baixa sozinho." : "";
  return `${base}${auto2} O lançamento do extrato, se houver, não é apagado.`;
}

/** Aviso (alerta vermelho) de apagar lançamento: efeito no saldo, nos relatórios e nas contas que ele pagou. */
export function lancamentoApagarAviso(l: { valor: number; conta: string; data: string }, usos: { fixas: number; avulsas: number }): string {
  const mes = l.data.length >= 7 ? monthLabel(l.data.slice(0, 7)) : l.data;
  const base = `Apaga o lançamento de ${formatBRL(Math.abs(l.valor))} (${brDate(l.data)}): o saldo de ${l.conta} e os relatórios de ${mes} passam a ser calculados sem ele.`;
  const n = usos.fixas + usos.avulsas;
  if (n === 0) return base;
  const quais = [usos.fixas ? `${usos.fixas} conta${usos.fixas > 1 ? "s" : ""} fixa${usos.fixas > 1 ? "s" : ""}` : "", usos.avulsas ? `${usos.avulsas} conta${usos.avulsas > 1 ? "s" : ""} avulsa${usos.avulsas > 1 ? "s" : ""}` : ""].filter(Boolean).join(" e ");
  return `${base} Ele deu baixa em ${quais}: ${n > 1 ? "continuam marcadas" : "continua marcada"} como ${n > 1 ? "pagas" : "paga"}, mas sem ligação com o extrato.`;
}

/** Aviso de apagar conta fixa com pagamentos registrados (somem junto; o extrato não é tocado). */
export function contaFixaApagarAviso(pagamentos: number): string | null {
  return pagamentos > 0 ? `${pagamentos === 1 ? "O pagamento registrado" : `Os ${pagamentos} pagamentos registrados`} desta conta também ${pagamentos === 1 ? "é apagado" : "são apagados"}. Os lançamentos do extrato ficam.` : null;
}

/** Aviso de apagar evento: some do Google Calendar de verdade (não só do app). */
export function eventoApagarAviso(agenda: string | null, consultasLigadas: number): string {
  const onde = agenda ? `da agenda “${agenda}” do Google Calendar` : "do Google Calendar";
  const consulta = consultasLigadas > 0 ? ` Ele é o evento de ${consultasLigadas === 1 ? "uma consulta" : `${consultasLigadas} consultas`} de Saúde: ${consultasLigadas === 1 ? "a consulta continua" : "as consultas continuam"} em Saúde, sem evento.` : "";
  return `Este evento será apagado de verdade ${onde}: ele some do Google, não só do app.${consulta}`;
}

/**
 * Consulta de Saúde espelhada na Agenda (agenda_event_id): apagar ou cancelar tira o evento do Google Calendar;
 * editar (ainda agendada) atualiza o evento. Sem evento ligado ou com a Agenda desligada, sem aviso.
 */
export function consultaAgendaAviso(a: { acao: AlterarAcao; temEvento: boolean; agendaLigada: boolean; statusAntes: string; statusDepois: string }): string | null {
  if (!a.temEvento || !a.agendaLigada) return null;
  const sai = a.acao === "apagar" || (a.statusDepois === "cancelada" && a.statusAntes !== "cancelada");
  if (sai) return "Esta consulta está na Agenda: o evento dela também será apagado do Google Calendar.";
  if ((a.acao === "editar" || a.acao === "acrescentar") && a.statusDepois === "agendada") return "Esta consulta está na Agenda: o evento dela no Google Calendar também será atualizado.";
  return null;
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
  saude: {
    consultas: {
      aba: "saude",
      secao: "consultas",
      rotulo: "Consulta",
      table: "health_appointments",
      cols: "id, member_id, kind, specialty, doctor, place, starts_at, status, notes, return_of, agenda_event_id",
      acoes: ["criar", "editar", "apagar", "concluir", "acrescentar"],
      campos: [
        PESSOA,
        { arg: "tipo", key: "kind", label: "Tipo", kind: "opcao", opcoes: KIND_LABEL },
        TEXTO("especialidade", "specialty", "Especialidade"),
        TEXTO("medico", "doctor", "Médico"),
        TEXTO("local", "place", "Local"),
        { arg: "inicio", key: "starts_at", label: "Data e hora", kind: "datahora" },
        { arg: "situacao", key: "status", label: "Situação", kind: "opcao", opcoes: STATUS_LABEL },
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({
        member_id: s(r.member_id),
        kind: s(r.kind),
        specialty: s(r.specialty),
        doctor: s(r.doctor),
        place: s(r.place),
        starts_at: typeof r.starts_at === "string" ? toSpLocal(r.starts_at) : "",
        status: s(r.status),
        notes: s(r.notes),
        return_of: s(r.return_of),
      }),
      defaults: (lk) => ({ kind: "consulta", status: "agendada", ...soUm(lk) }),
      validate: (raw, lk) => saudeValidate(raw, lk, validateAppointmentInput),
      titulo: (r) => [KIND_LABEL[str(r, "kind") as keyof typeof KIND_LABEL] ?? "Consulta", str(r, "specialty")].filter(Boolean).join(" · "),
      acrescentar: "notes",
      concluir: {
        // "Marcar realizada/cancelada" da tela (setAppointmentStatus): só a situação muda.
        campos: [{ arg: "situacao", key: "status", label: "Situação", kind: "opcao", opcoes: STATUS_LABEL }],
        plan: (row, raw) => {
          const alvo = str(raw, "status") || "realizada";
          const atual = s(row.status);
          if (alvo === atual) return { ok: false, erro: `Essa consulta já está ${STATUS_LABEL[atual as keyof typeof STATUS_LABEL]?.toLowerCase() ?? atual}.` };
          return {
            ok: true,
            campos: [{ rotulo: "Situação", antes: STATUS_LABEL[atual as keyof typeof STATUS_LABEL] ?? atual, depois: STATUS_LABEL[alvo as keyof typeof STATUS_LABEL] ?? alvo }],
            raw: { status: alvo },
          };
        },
      },
    },
    exames: {
      aba: "saude",
      secao: "exames",
      rotulo: "Exame",
      table: "health_exams",
      cols: "id, member_id, name, exam_date, lab, requested_by, result_summary, file_path",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [PESSOA, TEXTO("nome", "name", "Exame"), DATA("data", "exam_date", "Data"), TEXTO("laboratorio", "lab", "Laboratório"), TEXTO("pedido_por", "requested_by", "Pedido por"), TEXTO("resultado", "result_summary", "Resultado anotado")],
      rowToRaw: (r) => ({ member_id: s(r.member_id), name: s(r.name), exam_date: s(r.exam_date), lab: s(r.lab), requested_by: s(r.requested_by), result_summary: s(r.result_summary) }),
      defaults: soUm,
      validate: (raw, lk) => saudeValidate(raw, lk, validateExamInput),
      titulo: (r) => str(r, "name"),
      acrescentar: "result_summary",
    },
    vacinas: {
      aba: "saude",
      secao: "vacinas",
      rotulo: "Vacina",
      table: "health_vaccines",
      cols: "id, member_id, name, dose_label, applied_on, next_dose_on, place, lot, notes, file_path",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [
        PESSOA,
        TEXTO("nome", "name", "Vacina"),
        TEXTO("dose", "dose_label", "Dose"),
        DATA("data", "applied_on", "Aplicada em"),
        DATA("proxima", "next_dose_on", "Próxima dose"),
        TEXTO("local", "place", "Local"),
        TEXTO("lote", "lot", "Lote"),
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({ member_id: s(r.member_id), name: s(r.name), dose_label: s(r.dose_label), applied_on: s(r.applied_on), next_dose_on: s(r.next_dose_on), place: s(r.place), lot: s(r.lot), notes: s(r.notes) }),
      defaults: soUm,
      validate: (raw, lk) => saudeValidate(raw, lk, validateVaccineInput),
      titulo: (r) => str(r, "name"),
      acrescentar: "notes",
    },
    procedimentos: {
      aba: "saude",
      secao: "procedimentos",
      rotulo: "Procedimento",
      table: "health_procedures",
      cols: "id, member_id, name, performed_on, place, doctor, notes, file_path",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [PESSOA, TEXTO("nome", "name", "Procedimento"), DATA("data", "performed_on", "Data"), TEXTO("local", "place", "Local"), TEXTO("medico", "doctor", "Médico"), TEXTO("notas", "notes", "Observações")],
      rowToRaw: (r) => ({ member_id: s(r.member_id), name: s(r.name), performed_on: s(r.performed_on), place: s(r.place), doctor: s(r.doctor), notes: s(r.notes) }),
      defaults: soUm,
      validate: (raw, lk) => saudeValidate(raw, lk, validateProcedureInput),
      titulo: (r) => str(r, "name"),
      acrescentar: "notes",
    },
    medicamentos: {
      aba: "saude",
      secao: "medicamentos",
      rotulo: "Medicamento",
      table: "health_medications",
      cols: "id, member_id, name, dosage, frequency, started_on, ended_on, active, prescribed_by, notes, reminder_times",
      acoes: ["criar", "editar", "apagar", "concluir", "acrescentar"],
      campos: [
        PESSOA,
        TEXTO("nome", "name", "Medicamento"),
        TEXTO("dosagem", "dosage", "Dosagem"),
        TEXTO("frequencia", "frequency", "Frequência"),
        DATA("inicio", "started_on", "Início"),
        DATA("fim", "ended_on", "Término"),
        TEXTO("prescrito_por", "prescribed_by", "Prescrito por"),
        { arg: "horarios", key: "reminder_times", label: "Horários dos avisos", kind: "horas" },
        TEXTO("notas", "notes", "Observações"),
      ],
      rowToRaw: (r) => ({
        member_id: s(r.member_id),
        name: s(r.name),
        dosage: s(r.dosage),
        frequency: s(r.frequency),
        started_on: s(r.started_on),
        ended_on: s(r.ended_on),
        prescribed_by: s(r.prescribed_by),
        notes: s(r.notes),
        reminder_times: Array.isArray(r.reminder_times) ? r.reminder_times.map((t) => String(t).slice(0, 5)) : [],
      }),
      defaults: soUm,
      validate: (raw, lk) => saudeValidate(raw, lk, validateMedicationInput),
      titulo: (r) => str(r, "name"),
      acrescentar: "notes",
      concluir: {
        // Encerrar (ativo false) ou voltar a usar (ativo true): setMedicationActive, como o botão da tela.
        campos: [{ arg: "ativo", key: "active", label: "Em uso", kind: "sim_nao" }],
        plan: (row, raw, lk) => {
          if (raw.active !== "true" && raw.active !== "false") return { ok: false, erro: "Diga se é para encerrar (ativo false) ou voltar a usar (ativo true)." };
          const alvo = raw.active === "true";
          if ((row.active === true) === alvo) return { ok: false, erro: alvo ? "Esse medicamento já está em uso." : "Esse medicamento já está encerrado." };
          const fim = alvo ? null : endDateFor(typeof row.started_on === "string" ? row.started_on : null, lk.today);
          const campos: AlteracaoCampo[] = [{ rotulo: "Situação", antes: alvo ? "Encerrado" : "Em uso", depois: alvo ? "Em uso" : "Encerrado" }];
          campos.push({ rotulo: "Término", antes: typeof row.ended_on === "string" ? brDate(row.ended_on) : null, depois: fim ? brDate(fim) : "removido" });
          return { ok: true, campos, raw: { active: alvo ? "true" : "false" } };
        },
      },
    },
    carteirinhas: {
      aba: "saude",
      secao: "carteirinhas",
      rotulo: "Carteirinha",
      table: "health_insurance_cards",
      cols: "id, member_id, operator, card_number, plan_name, valid_until, notes, file_path",
      // Criar exige o PDF/foto da carteirinha (a tela pede o arquivo): o Oli só edita e apaga.
      acoes: ["editar", "apagar", "acrescentar"],
      campos: [PESSOA, TEXTO("operadora", "operator", "Operadora"), TEXTO("numero", "card_number", "Número"), TEXTO("plano", "plan_name", "Plano"), DATA("validade", "valid_until", "Validade"), TEXTO("notas", "notes", "Observações")],
      rowToRaw: (r) => ({ member_id: s(r.member_id), operator: s(r.operator), card_number: s(r.card_number), plan_name: s(r.plan_name), valid_until: s(r.valid_until), notes: s(r.notes) }),
      validate: (raw, lk) => saudeValidate(raw, lk, validateCardInput),
      titulo: (r) => str(r, "operator"),
      acrescentar: "notes",
    },
  },
  agenda: {
    eventos: {
      aba: "agenda",
      secao: "eventos",
      rotulo: "Evento",
      table: "cal_events",
      cols: "id, calendar_ref, title, description, location, all_day, starts_at, ends_at",
      acoes: ["criar", "editar", "apagar"],
      campos: [
        TEXTO("titulo", "title", "Título"),
        { arg: "dia_inteiro", key: "all_day", label: "Dia inteiro", kind: "marca" },
        { arg: "inicio", key: "start", label: "Início", kind: "datahora" },
        { arg: "fim", key: "end", label: "Fim", kind: "datahora" },
        TEXTO("local", "location", "Local"),
        TEXTO("descricao", "description", "Descrição"),
        { arg: "agenda", key: "calendar_id", label: "Agenda", kind: "agenda" },
      ],
      // Dia inteiro: início e fim são dias (fim inclusivo, como o formulário); senão, horário de São Paulo.
      rowToRaw: (r) => {
        const allDay = r.all_day === true;
        const sMs = Date.parse(s(r.starts_at));
        const eMs = Date.parse(s(r.ends_at));
        const first = toSpDate(sMs);
        return {
          title: s(r.title),
          all_day: on(allDay),
          start: allDay ? first : toSpLocal(sMs),
          end: allDay ? (eMs > sMs ? toSpDate(eMs - 1) : first) : toSpLocal(eMs),
          location: s(r.location),
          description: s(r.description),
          calendar_id: s(r.calendar_ref),
        };
      },
      defaults: (lk): Raw => {
        const cals = lk.calendars ?? [];
        const primarias = cals.filter((c) => c.primary);
        const cal = primarias.length === 1 ? primarias[0] : cals.length === 1 ? cals[0] : null;
        return cal ? { calendar_id: cal.id } : {};
      },
      validate: (raw, lk) => {
        const cals = lk.calendars ?? [];
        if (cals.length === 0) return { ok: false, erro: "Nenhuma agenda sua conectada. Conecte o Google na tela Agenda." };
        if (!str(raw, "calendar_id")) return { ok: false, erro: `Pergunte em qual agenda criar. Opções: ${cals.map((c) => c.summary).join(", ")}.` };
        if (!cals.some((c) => c.id === str(raw, "calendar_id"))) return { ok: false, erro: "Agenda não encontrada." };
        const v = validateEventInput({ title: str(raw, "title"), allDay: raw.all_day === "on", start: str(raw, "start"), end: str(raw, "end"), location: str(raw, "location"), description: str(raw, "description") });
        return v.ok ? { ok: true } : { ok: false, erro: v.erro };
      },
      titulo: (r) => str(r, "title"),
      // A agenda do evento não muda na edição (o Google não move o evento entre agendas aqui).
      fixos: ["agenda"],
      rowOk: (_row, lk) => {
        const ev = lk.extra?.evento;
        if (!ev) return "Não consegui conferir de quem é o evento. Nada foi alterado: tente de novo.";
        return ev.editavel ? null : `Esse evento está na agenda de ${ev.dono}: só quem é dono da agenda pode alterar ou apagar.`;
      },
      formEntries: (raw) => {
        const allDay = raw.all_day === "on";
        const out: [string, string][] = [["title", str(raw, "title")]];
        if (allDay) out.push(["all_day", "on"], ["start_date", str(raw, "start").slice(0, 10)], ["end_date", (str(raw, "end") || str(raw, "start")).slice(0, 10)]);
        else out.push(["start", str(raw, "start")], ["end", str(raw, "end")]);
        out.push(["location", str(raw, "location")], ["description", str(raw, "description")], ["calendar_id", str(raw, "calendar_id")]);
        return out;
      },
    },
  },
  financas: {
    contas_fixas: {
      aba: "financas",
      secao: "contas_fixas",
      rotulo: "Conta fixa",
      table: "fin_bills",
      cols: "id, name, amount, due_day, category_id, account_id, active, is_home",
      acoes: ["criar", "editar", "apagar", "concluir"],
      campos: [
        TEXTO("nome", "name", "Conta"),
        DINHEIRO("valor", "amount", "Valor"),
        { arg: "dia_vencimento", key: "due_day", label: "Dia do vencimento", kind: "inteiro" },
        { arg: "categoria", key: "category_id", label: "Categoria", kind: "categoria" },
        { arg: "conta", key: "account_id", label: "Conta bancária", kind: "conta" },
        { arg: "inativa", key: "inactive", label: "Inativa", kind: "marca" },
        { arg: "da_casa", key: "is_home", label: "Conta da casa", kind: "marca" },
      ],
      rowToRaw: (r) => ({
        name: s(r.name),
        amount: money(r.amount),
        due_day: s(r.due_day),
        category_id: s(r.category_id),
        account_id: s(r.account_id),
        inactive: on(r.active === false),
        is_home: on(r.is_home),
      }),
      validate: (raw, lk) => validarContaFixa(raw, lk),
      titulo: (r) => str(r, "name"),
      concluir: {
        // "Marcar paga" (payBill) ou "desfazer pagamento" (undoPayment) de um mês, como a tela Contas fixas.
        campos: [
          { arg: "mes", key: "month", label: "Mês", kind: "texto" },
          { arg: "pago", key: "pago", label: "Pago", kind: "sim_nao" },
          { arg: "lancamento", key: "transaction_id", label: "Lançamento", kind: "texto" },
          DATA("data", "paid_on", "Pago em"),
          DINHEIRO("valor", "amount", "Valor pago"),
        ],
        plan: (row, raw, lk) => planPagamento("fixa", row, raw, lk),
      },
    },
    contas_avulsas: {
      aba: "financas",
      secao: "contas_avulsas",
      rotulo: "Conta avulsa",
      table: "fin_one_off_bills",
      cols: "id, name, amount, due_date, account_id, category_id, paid_on, transaction_id, paid_auto, is_home",
      // A tela só edita avulsa existente (ela nasce da conferência do boleto/comprovante): o Oli não cria.
      acoes: ["editar", "apagar", "concluir"],
      campos: [
        TEXTO("nome", "name", "Conta"),
        DINHEIRO("valor", "amount", "Valor"),
        DATA("vencimento", "due_date", "Vencimento"),
        { arg: "categoria", key: "category_id", label: "Categoria", kind: "categoria" },
        { arg: "conta", key: "account_id", label: "Conta bancária", kind: "conta" },
        { arg: "da_casa", key: "is_home", label: "Conta da casa", kind: "marca" },
      ],
      rowToRaw: (r) => ({ name: s(r.name), amount: money(r.amount), due_date: s(r.due_date), category_id: s(r.category_id), account_id: s(r.account_id), is_home: on(r.is_home) }),
      validate: (raw) => {
        const v = validateOneOffInput({ name: str(raw, "name"), amount: str(raw, "amount"), dueDate: str(raw, "due_date") });
        return v.ok ? { ok: true } : { ok: false, erro: v.erro };
      },
      titulo: (r) => str(r, "name"),
      concluir: {
        campos: [
          { arg: "pago", key: "pago", label: "Pago", kind: "sim_nao" },
          { arg: "lancamento", key: "transaction_id", label: "Lançamento", kind: "texto" },
          DATA("data", "paid_on", "Pago em"),
        ],
        plan: (row, raw, lk) => planPagamento("avulsa", row, raw, lk),
      },
    },
    metas: {
      aba: "financas",
      secao: "metas",
      rotulo: "Meta",
      table: "fin_goals",
      cols: "id, name, target, account_id, target_date",
      acoes: ["criar", "editar", "apagar"],
      campos: [
        TEXTO("nome", "name", "Meta"),
        DINHEIRO("valor", "target", "Valor da meta"),
        DATA("prazo", "target_date", "Prazo"),
        { arg: "conta", key: "account_id", label: "Conta onde fica guardado", kind: "conta" },
      ],
      rowToRaw: (r) => ({ name: s(r.name), target: money(r.target), target_date: s(r.target_date), account_id: s(r.account_id) }),
      defaults: (lk): Raw => (lk.accounts?.length === 1 ? { account_id: lk.accounts[0].id } : {}),
      validate: (raw, lk) => validarMeta(raw, lk),
      titulo: (r) => str(r, "name"),
    },
    orcamento: {
      aba: "financas",
      secao: "orcamento",
      rotulo: "Orçamento",
      // Sem id: o orçamento é da categoria (todos os meses ou só um mês). O servidor acha a linha pela categoria.
      table: "fin_budgets",
      cols: "id, category_id, month, amount",
      acoes: ["criar", "editar", "apagar"],
      semId: true,
      campos: [
        { arg: "categoria", key: "category_id", label: "Categoria", kind: "categoria" },
        { arg: "escopo", key: "scope", label: "Vale para", kind: "opcao", opcoes: { todos: "Todos os meses", mes: "Só um mês" } },
        { arg: "mes", key: "month", label: "Mês", kind: "texto" },
        DINHEIRO("valor", "amount", "Valor"),
      ],
      rowToRaw: (r) => ({ category_id: s(r.category_id), scope: r.month ? "mes" : "todos", month: s(r.month), amount: money(r.amount) }),
      defaults: (lk) => ({ scope: "todos", month: lk.today.slice(0, 7) }),
      // A tela manda sempre um mês; para "todos os meses" ele é ignorado pela action (scope != mes).
      ajustar: (raw, lk) => {
        if (str(raw, "scope") !== "mes" || !str(raw, "month")) raw.month = lk.today.slice(0, 7);
      },
      ocultar: (raw) => (str(raw, "scope") === "mes" ? [] : ["month"]),
      validate: (raw, lk) => validarOrcamento(raw, lk),
      titulo: (r, lk) => lk?.categories?.find((c) => c.id === str(r, "category_id"))?.name ?? "Orçamento",
      // Categoria, escopo e mês dizem QUAL orçamento (o servidor acha a linha por eles).
    },
    lancamentos: {
      aba: "financas",
      secao: "lancamentos",
      rotulo: "Lançamento",
      table: "fin_transactions",
      cols: "id, account_id, date, description, amount, category_id, member_id, notes, source",
      acoes: ["criar", "editar", "apagar", "acrescentar"],
      campos: [
        TEXTO("descricao", "description", "Descrição"),
        DINHEIRO("valor", "amount", "Valor"),
        { arg: "tipo", key: "direction", label: "Tipo", kind: "opcao", opcoes: { saida: "Saída", entrada: "Entrada" } },
        DATA("data", "date", "Data"),
        { arg: "conta", key: "account_id", label: "Conta", kind: "conta" },
        { arg: "categoria", key: "category_id", label: "Categoria", kind: "categoria" },
        TEXTO("notas", "notes", "Observações"),
      ],
      // Mesma regra da tela: valor positivo + Entrada/Saída; o sinal gravado vem da direção (validateManualTransaction).
      rowToRaw: (r) => ({
        description: s(r.description),
        amount: money(Math.abs(Number(r.amount))),
        direction: Number(r.amount) > 0 ? "entrada" : "saida",
        date: s(r.date),
        account_id: s(r.account_id),
        category_id: s(r.category_id),
        member_id: s(r.member_id),
        notes: s(r.notes),
      }),
      defaults: (lk): Raw => ({ direction: "saida", date: lk.today, member_id: lk.me?.id ?? "", ...(lk.accounts?.length === 1 ? { account_id: lk.accounts[0].id } : {}) }),
      validate: (raw, lk) => validarLancamento(raw, lk),
      titulo: (r) => str(r, "description"),
      acrescentar: "notes",
      rowOk: (row) => {
        const origem = row.source;
        if (origem === "openfinance") return OPEN_FINANCE_RECUSA;
        return (ORIGENS_EDITAVEIS as readonly unknown[]).includes(origem) ? null : ORIGEM_DESCONHECIDA;
      },
    },
  },
};

export function specFor(aba: AlterarAba, secao: string): Spec | null {
  return SPECS[aba]?.[secao] ?? null;
}

export const SECOES_ALTERAR: Record<AlterarAba, readonly string[]> = { casa: CASA_ALTERAR, pet: PET_ALTERAR, igreja: IGREJA_ALTERAR, saude: SAUDE_ALTERAR, agenda: AGENDA_ALTERAR, financas: FINANCAS_ALTERAR };

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
  if (typeof aba !== "string" || !(ABAS_ALTERAR as readonly string[]).includes(aba)) return { ok: false, erro: "Aba inválida." };
  const abaOk = aba as AlterarAba;
  const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const acao = typeof a.acao === "string" ? normalizeName(a.acao) : "";
  if (!(ALTERAR_ACOES as readonly string[]).includes(acao)) return { ok: false, erro: `Ação inválida. Use: ${ALTERAR_ACOES.join(", ")}.` };
  const secaoRaw = typeof a.secao === "string" ? normalizeName(a.secao).replace(/[\s-]+/g, "_") : "";
  const spec = specFor(abaOk, secaoRaw);
  if (!spec) return { ok: false, erro: `Seção inválida. Use: ${SECOES_ALTERAR[abaOk].join(", ")}.` };
  const act = acao as AlterarAcao;
  if (!spec.acoes.includes(act)) return { ok: false, erro: `Em ${spec.secao} dá para: ${spec.acoes.join(", ")}.` };

  let id: string | null = null;
  if (spec.semId) {
    // Orçamento: sem id; quem identifica é a categoria (e o escopo/mês).
    if (present(a.id)) return { ok: false, erro: `${spec.rotulo} não usa id: diga a categoria.` };
    if (!present(a.categoria)) return { ok: false, erro: "Diga a categoria do orçamento." };
  } else if (act === "criar") {
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
  if (spec.semId && act === "apagar" && "valor" in valores) return { ok: false, erro: "Para apagar o orçamento não mande valor." };
  if (spec.semId && (act === "criar" || act === "editar") && !("valor" in valores)) return { ok: false, erro: "Diga o valor do orçamento." };
  if (!spec.semId && (act === "apagar" || act === "acrescentar") && Object.keys(valores).length > 0)
    return { ok: false, erro: `Para ${act}, mande só o id${act === "acrescentar" ? " e a frase" : ""}.` };
  if (act === "editar" && Object.keys(valores).length === 0) return { ok: false, erro: "Diga o que mudar." };
  return { ok: true, value: { aba: abaOk, acao: act, secao: spec.secao, id, frase, valores } };
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
  if (a.acao === "criar" && spec.semId && row) return { ok: false, erro: `Já existe ${spec.rotulo.toLowerCase()} para essa categoria: use editar.` };
  if (a.acao !== "criar") {
    if (!row) return { ok: false, erro: `${spec.rotulo} não encontrada(o).${spec.semId ? " Para criar, use acao criar." : ""}` };
    const bad = spec.rowOk?.(row, lk);
    if (bad) return { ok: false, erro: bad };
    if (spec.dono && !canEdit({ owner_id: s(row.owner_id), shared: row.shared === true }, lk.uid)) return { ok: false, erro: NAO_E_SEU(donoNome(row, lk)) };
  }
  const base: Raw = a.acao === "criar" ? (spec.defaults?.(lk) ?? {}) : spec.rowToRaw(row!);
  const raw: Raw = { ...base };
  spec.ajustar?.(raw, lk);
  const campoVisivel = (c: Campo) => !spec.ocultar?.(raw).includes(c.key);
  const preview = (campos: AlteracaoCampo[], anexo: AlteracaoPreview["anexo"] = null): AlteracaoPreview => ({
    aba: a.aba,
    secao: spec.secao,
    acao: a.acao,
    id: a.id,
    rotulo: spec.rotulo,
    titulo: spec.titulo(raw, lk) || spec.rotulo,
    campos,
    anexo,
    aviso: null,
    args: flatArgs(a),
  });

  if (a.acao === "apagar") {
    const campos = spec.campos.filter(campoVisivel).map((c) => ({ rotulo: c.label, antes: show(c, raw, lk), depois: null })).filter((c) => c.antes !== null);
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
    if (r.aviso) p.aviso = r.aviso;
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
  spec.ajustar?.(raw, lk);
  const v = spec.validate(raw, lk);
  if (!v.ok) return v;
  if (a.acao === "criar") {
    const campos = spec.campos.filter(campoVisivel).map((c) => ({ rotulo: c.label, antes: null, depois: show(c, raw, lk) })).filter((c) => c.depois !== null);
    return { ok: true, plan: { preview: preview(campos), raw, spec } };
  }
  const campos = spec.campos
    .filter(campoVisivel)
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
  if (plan.spec.formEntries) return [...out, ...plan.spec.formEntries(plan.raw)];
  for (const [k, v] of Object.entries(plan.raw)) {
    if (Array.isArray(v)) for (const x of v) out.push([k, x]);
    else out.push([k, v]);
  }
  return out;
}

/** Aviso de lixeira do Drive ao apagar uma aula: só pasta, só arquivos ou os dois; sem nenhum dos dois, sem aviso. */
export function driveAviso(temPasta: boolean, arquivos: number): string | null {
  if (arquivos > 0 && temPasta) return `A pasta da aula e ${arquivos === 1 ? "o arquivo" : `os ${arquivos} arquivos`} vão para a lixeira do seu Google Drive.`;
  if (arquivos > 0) return arquivos === 1 ? "O arquivo da aula vai para a lixeira do seu Google Drive." : `Os ${arquivos} arquivos da aula vão para a lixeira do seu Google Drive.`;
  if (temPasta) return "A pasta da aula vai para a lixeira do seu Google Drive.";
  return null;
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
