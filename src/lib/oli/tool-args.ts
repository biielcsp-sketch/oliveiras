/**
 * Validação dos argumentos que o modelo manda para as ferramentas do Oli.
 * Roda no servidor (server actions). Erro vira { erro } curto, que volta ao modelo.
 */
import { MAX_AMOUNT, UUID_RE, validDate } from "@/lib/financas/transaction-input";
import { addDays, diffDays, isDate, normalizeLocal } from "@/lib/agenda/dates";
import { EVENT_LIMITS } from "@/lib/agenda/input";
import { todaySP } from "@/lib/financas/today";
import { KINDS, LIMITS as SAUDE_LIMITS } from "@/lib/saude/input";
import type { AppointmentKind } from "@/lib/saude/types";
import { cleanLine, CONVERSA_TERMO_MAX, CONVERSA_TERMO_MIN, type BuscarConversaArgs } from "./conversa";

export const OLI_TOOL_NAMES = [
  "resumo_do_mes",
  "saldo_das_contas",
  "contas_a_pagar",
  "ultimos_lancamentos",
  "criar_lancamento",
  "salvar_memoria",
  "consultar_memoria",
  "esquecer_memoria",
  "buscar_conversa",
  "agenda_periodo",
  "criar_evento",
  "documentos_recentes",
  "ler_documento",
  "criar_consulta",
  "consultar_financas",
  "analisar",
  "consultar_saude",
  "consultar_exames_lab",
  "consultar_casa",
  "consultar_pet",
  "consultar_igreja",
  "buscar_no_app",
  "ler_arquivo",
  "ler_ultimo_arquivo",
  "alterar_casa",
  "alterar_pet",
  "alterar_igreja",
  "alterar_saude",
  "alterar_agenda",
  "alterar_financas",
] as const;
export type OliToolName = (typeof OLI_TOOL_NAMES)[number];

export const MEMORY_CATEGORIES = [
  "geral",
  "preferencia",
  "pessoa",
  "financas",
  "casa",
  "saude",
  "ministerio",
  "agenda",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const LIMITS = {
  description: 200,
  name: 60,
  search: 60,
  memorySearch: 100,
  memoryMin: 3,
  memoryMax: 500,
  txDefault: 10,
  txMax: 20,
} as const;

export type ArgError = { erro: string };
type Result<T> = { ok: true; value: T } | ({ ok: false } & ArgError);

const fail = (erro: string): { ok: false; erro: string } => ({ ok: false, erro });
const ok = <T,>(value: T): { ok: true; value: T } => ({ ok: true, value });

export function isToolName(name: unknown): name is OliToolName {
  return typeof name === "string" && (OLI_TOOL_NAMES as readonly string[]).includes(name);
}

/** Só objetos simples; qualquer outra coisa vira {}. */
function obj(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

/** Texto opcional: undefined/null/"" → undefined; outro tipo ou longo demais → erro. */
function optText(v: unknown, max: number, label: string): Result<string | undefined> {
  if (v === undefined || v === null) return ok(undefined);
  if (typeof v !== "string") return fail(`${label} inválido.`);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return ok(undefined);
  if (t.length > max) return fail(`${label} muito longo (máximo ${max}).`);
  return ok(t);
}

function reqText(v: unknown, max: number, label: string): Result<string> {
  const r = optText(v, max, label);
  if (!r.ok) return r;
  if (!r.value) return fail(`${label} é obrigatório.`);
  return ok(r.value);
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseResumoArgs(args: unknown): Result<{ mes?: string }> {
  const r = optText(obj(args).mes, 7, "Mês");
  if (!r.ok) return r;
  if (r.value && !MONTH_RE.test(r.value)) return fail("Mês inválido. Use AAAA-MM.");
  return ok({ mes: r.value });
}

export function parseUltimosArgs(args: unknown): Result<{ limite: number; busca?: string }> {
  const a = obj(args);
  let limite: number = LIMITS.txDefault;
  if (a.limite !== undefined && a.limite !== null) {
    const n = typeof a.limite === "string" ? Number(a.limite) : a.limite;
    if (typeof n !== "number" || !Number.isFinite(n)) return fail("Limite inválido.");
    limite = Math.min(LIMITS.txMax, Math.max(1, Math.trunc(n)));
  }
  const busca = optText(a.busca, LIMITS.search, "Busca");
  if (!busca.ok) return busca;
  return ok({ limite, busca: busca.value });
}

export type CriarLancamentoArgs = {
  descricao: string;
  valor: number;
  categoria: string;
  conta?: string;
  data?: string;
};

export function parseCriarLancamentoArgs(args: unknown): Result<CriarLancamentoArgs> {
  const a = obj(args);
  const descricao = reqText(a.descricao, LIMITS.description, "Descrição");
  if (!descricao.ok) return descricao;
  const raw = typeof a.valor === "string" ? Number(a.valor.replace(",", ".")) : a.valor;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw === 0 || Math.abs(raw) > MAX_AMOUNT)
    return fail("Valor inválido.");
  const valor = Math.round(Math.abs(raw) * 100) / 100;
  if (valor === 0) return fail("Valor inválido.");
  const categoria = reqText(a.categoria, LIMITS.name, "Categoria");
  if (!categoria.ok) return categoria;
  const conta = optText(a.conta, LIMITS.name, "Conta");
  if (!conta.ok) return conta;
  const data = optText(a.data, 10, "Data");
  if (!data.ok) return data;
  if (data.value && !validDate(data.value)) return fail("Data inválida. Use AAAA-MM-DD.");
  return ok({ descricao: descricao.value, valor, categoria: categoria.value, conta: conta.value, data: data.value });
}

export const DOCS_DEFAULT = 10;

/** documentos_recentes: limite opcional de 1 a 10 (padrão 10). */
export function parseDocumentosArgs(args: unknown): Result<{ limite: number }> {
  const a = obj(args);
  let limite = DOCS_DEFAULT;
  if (a.limite !== undefined && a.limite !== null) {
    const n = typeof a.limite === "string" ? Number(a.limite) : a.limite;
    if (typeof n !== "number" || !Number.isFinite(n)) return fail("Limite inválido.");
    limite = Math.min(DOCS_DEFAULT, Math.max(1, Math.trunc(n)));
  }
  return ok({ limite });
}

/** ler_documento: id (uuid) de um documento da família. */
export function parseLerDocumentoArgs(args: unknown): Result<{ id: string }> {
  const id = obj(args).id;
  if (typeof id !== "string" || !UUID_RE.test(id.trim())) return fail("Id de documento inválido.");
  return ok({ id: id.trim().toLowerCase() });
}

export function parseSalvarMemoriaArgs(args: unknown): Result<{ conteudo: string; categoria: MemoryCategory }> {
  const a = obj(args);
  const conteudo = reqText(a.conteudo, LIMITS.memoryMax, "Conteúdo");
  if (!conteudo.ok) return conteudo;
  if (conteudo.value.length < LIMITS.memoryMin) return fail("Conteúdo muito curto.");
  const cat = typeof a.categoria === "string" ? a.categoria.trim().toLowerCase() : "";
  const categoria = (MEMORY_CATEGORIES as readonly string[]).includes(cat) ? (cat as MemoryCategory) : "geral";
  return ok({ conteudo: conteudo.value, categoria });
}

export function parseConsultarMemoriaArgs(args: unknown): Result<{ busca: string }> {
  const busca = reqText(obj(args).busca, LIMITS.memorySearch, "Busca");
  if (!busca.ok) return busca;
  return ok({ busca: busca.value });
}

export function parseEsquecerMemoriaArgs(args: unknown): Result<{ id: string }> {
  const id = obj(args).id;
  if (typeof id !== "string" || !UUID_RE.test(id.trim())) return fail("Id de memória inválido.");
  return ok({ id: id.trim().toLowerCase() });
}

/**
 * buscar_conversa: termo (2 a 80, uma linha, sem < > nem controles; "*" sai porque vira curinga no ilike do
 * PostgREST) e desde/ate opcionais em AAAA-MM-DD.
 */
export function parseBuscarConversaArgs(args: unknown): Result<BuscarConversaArgs> {
  const a = obj(args);
  if (typeof a.termo !== "string") return fail("Termo é obrigatório.");
  const termo = cleanLine(a.termo.replace(/\*/g, " "));
  if (termo.length < CONVERSA_TERMO_MIN) return fail(`Termo muito curto (mínimo ${CONVERSA_TERMO_MIN} caracteres).`);
  if (termo.length > CONVERSA_TERMO_MAX) return fail(`Termo muito longo (máximo ${CONVERSA_TERMO_MAX}).`);
  const desde = optText(a.desde, 10, "Data inicial");
  if (!desde.ok) return fail("Data inicial inválida. Use AAAA-MM-DD.");
  const ate = optText(a.ate, 10, "Data final");
  if (!ate.ok) return fail("Data final inválida. Use AAAA-MM-DD.");
  if (desde.value && !isDate(desde.value)) return fail("Data inicial inválida. Use AAAA-MM-DD.");
  if (ate.value && !isDate(ate.value)) return fail("Data final inválida. Use AAAA-MM-DD.");
  if (desde.value && ate.value && desde.value > ate.value) return fail("A data inicial é depois da final.");
  return ok({ termo, desde: desde.value, ate: ate.value });
}

/** Comparação de nomes sem acento e sem caixa ("Alimentação" = "alimentacao"). */
export function normalizeName(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Acha um item pelo nome: igual primeiro; senão, um único que contenha o texto. */
export function matchByName<T extends { name: string }>(items: T[], query: string): T | null {
  const q = normalizeName(query);
  if (!q) return null;
  const exact = items.filter((i) => normalizeName(i.name) === q);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((i) => normalizeName(i.name).includes(q) || q.includes(normalizeName(i.name)));
  return partial.length === 1 ? partial[0] : null;
}

/* ---------- Agenda ---------- */

export const AGENDA_DEFAULT_DAYS = 7;
export const AGENDA_MAX_DAYS = 31;

/** agenda_periodo: padrão hoje até +7 dias; no máximo 31 dias; pessoa opcional (nome). */
export function parseAgendaPeriodoArgs(args: unknown, today: string): Result<{ de: string; ate: string; pessoa?: string }> {
  const a = obj(args);
  const de = optText(a.de, 10, "Data inicial");
  if (!de.ok) return de;
  const ate = optText(a.ate, 10, "Data final");
  if (!ate.ok) return ate;
  if (de.value && !isDate(de.value)) return fail("Data inicial inválida. Use AAAA-MM-DD.");
  if (ate.value && !isDate(ate.value)) return fail("Data final inválida. Use AAAA-MM-DD.");
  const from = de.value ?? today;
  const to = ate.value ?? addDays(from, AGENDA_DEFAULT_DAYS);
  if (to < from) return fail("A data final é antes da inicial.");
  if (diffDays(from, to) > AGENDA_MAX_DAYS) return fail(`Período longo demais (máximo ${AGENDA_MAX_DAYS} dias).`);
  const pessoa = optText(a.pessoa, LIMITS.name, "Pessoa");
  if (!pessoa.ok) return pessoa;
  return ok({ de: from, ate: to, pessoa: pessoa.value });
}

export type CriarEventoArgs = {
  titulo: string;
  dia_inteiro: boolean;
  /** Dia inteiro: AAAA-MM-DD; senão AAAA-MM-DDTHH:mm (São Paulo). */
  inicio: string;
  fim?: string;
  local?: string;
  agenda?: string;
};

/** criar_evento: data sem hora (ou dia_inteiro) vira evento de dia inteiro. */
export function parseCriarEventoArgs(args: unknown): Result<CriarEventoArgs> {
  const a = obj(args);
  const titulo = reqText(a.titulo, EVENT_LIMITS.title, "Título");
  if (!titulo.ok) return titulo;
  const rawInicio = reqText(a.inicio, 25, "Início");
  if (!rawInicio.ok) return rawInicio;
  const rawFim = optText(a.fim, 25, "Fim");
  if (!rawFim.ok) return rawFim;
  if (a.dia_inteiro !== undefined && a.dia_inteiro !== null && typeof a.dia_inteiro !== "boolean") return fail("dia_inteiro inválido.");
  const dateOnly = isDate(rawInicio.value);
  const diaInteiro = a.dia_inteiro === true || (a.dia_inteiro !== false && dateOnly);
  let inicio: string;
  let fim: string | undefined;
  if (diaInteiro) {
    inicio = rawInicio.value.slice(0, 10);
    if (!isDate(inicio)) return fail("Início inválido. Use AAAA-MM-DD.");
    fim = rawFim.value?.slice(0, 10);
    if (fim && !isDate(fim)) return fail("Fim inválido. Use AAAA-MM-DD.");
  } else {
    const n = normalizeLocal(rawInicio.value);
    if (!n) return fail("Início inválido. Use AAAA-MM-DDTHH:mm.");
    inicio = n;
    if (rawFim.value) {
      const f = normalizeLocal(rawFim.value);
      if (!f) return fail("Fim inválido. Use AAAA-MM-DDTHH:mm.");
      fim = f;
    }
  }
  const local = optText(a.local, EVENT_LIMITS.location, "Local");
  if (!local.ok) return local;
  const agenda = optText(a.agenda, EVENT_LIMITS.title, "Agenda");
  if (!agenda.ok) return agenda;
  return ok({ titulo: titulo.value, dia_inteiro: diaInteiro, inicio, fim, local: local.value, agenda: agenda.value });
}

/* ---------- Saúde ---------- */

export type CriarConsultaArgs = {
  /** Nome do membro; vazio ou "eu" = o usuário logado. */
  pessoa?: string;
  tipo: AppointmentKind;
  especialidade?: string;
  medico?: string;
  local?: string;
  /** AAAA-MM-DDTHH:mm (São Paulo). */
  inicio: string;
  observacoes?: string;
};

/** criar_consulta: limites iguais aos do formulário de Saúde; a validação completa roda em validateAppointmentInput. */
export function parseCriarConsultaArgs(args: unknown): Result<CriarConsultaArgs> {
  const a = obj(args);
  const pessoa = optText(a.pessoa, LIMITS.name, "Pessoa");
  if (!pessoa.ok) return pessoa;
  const tipoRaw = optText(a.tipo, 20, "Tipo");
  if (!tipoRaw.ok) return tipoRaw;
  const tipo = (tipoRaw.value ? normalizeName(tipoRaw.value) : "consulta") as AppointmentKind;
  if (!KINDS.includes(tipo)) return fail("Tipo inválido. Use consulta ou retorno.");
  const especialidade = optText(a.especialidade, SAUDE_LIMITS.specialty, "Especialidade");
  if (!especialidade.ok) return especialidade;
  const medico = optText(a.medico, SAUDE_LIMITS.doctor, "Médico");
  if (!medico.ok) return medico;
  const local = optText(a.local, SAUDE_LIMITS.place, "Local");
  if (!local.ok) return local;
  const rawInicio = reqText(a.inicio, 25, "Início");
  if (!rawInicio.ok) return rawInicio;
  const inicio = normalizeLocal(rawInicio.value);
  if (!inicio) return fail("Início inválido. Use AAAA-MM-DDTHH:mm.");
  const observacoes = optText(a.observacoes, SAUDE_LIMITS.apptNotes, "Observações");
  if (!observacoes.ok) return observacoes;
  return ok({
    pessoa: pessoa.value,
    tipo,
    especialidade: especialidade.value,
    medico: medico.value,
    local: local.value,
    inicio,
    observacoes: observacoes.value,
  });
}

/* ---------- Leitura total (consultas por aba, busca e leitura de arquivo guardado) ---------- */

export const FIN_SECOES = ["periodo", "metas", "orcamento", "contas_fixas", "contas_avulsas", "categorias"] as const;
export const SAUDE_SECOES = ["resumo", "consultas", "exames", "vacinas", "procedimentos", "medicamentos", "carteirinhas"] as const;
export const CASA_SECOES = ["resumo", "tarefas", "compras", "manutencao", "documentos", "cardapio", "prestadores"] as const;
export const PET_SECOES = ["resumo", "saude", "veterinario", "cuidados", "peso", "racao"] as const;
export const IGREJA_SECOES = ["resumo", "palavras", "promessas", "oracoes", "propositos", "carisma", "consolidacao"] as const;
export type FinSecao = (typeof FIN_SECOES)[number];
export type SaudeSecao = (typeof SAUDE_SECOES)[number];
export type CasaSecao = (typeof CASA_SECOES)[number];
export type PetSecao = (typeof PET_SECOES)[number];
export type IgrejaSecao = (typeof IGREJA_SECOES)[number];

/** Período máximo de uma consulta com de/até (dias). */
export const CONSULTA_MAX_DAYS = 92;
export const BUSCA_MIN = 2;

/** Seção: sem acento/caixa, espaço ou hífen vira "_" ("Manutenção" → manutencao; "contas fixas" → contas_fixas). */
function parseSecao<T extends string>(v: unknown, list: readonly T[], fallback: T): Result<T> {
  if (v === undefined || v === null || v === "") return ok(fallback);
  if (typeof v !== "string" || v.length > 40) return fail("Seção inválida.");
  const s = normalizeName(v).replace(/[\s-]+/g, "_");
  if (!s) return ok(fallback);
  return (list as readonly string[]).includes(s) ? ok(s as T) : fail(`Seção inválida. Use: ${list.join(", ")}.`);
}

/** Lado que falta quando vem só "ate": 30 dias antes. */
export const CONSULTA_DEFAULT_DAYS = 30;

/**
 * de/até opcionais (AAAA-MM-DD). Se vier só um lado, o outro é completado (só de → até hoje, ou +30 dias se
 * de for futuro; só até → 30 dias antes) e o teto de CONSULTA_MAX_DAYS vale sempre, inclusive nesse caso.
 */
function parsePeriodo(a: Record<string, unknown>, today: string): Result<{ de?: string; ate?: string }> {
  const de = optText(a.de, 10, "Data inicial");
  if (!de.ok) return de;
  const ate = optText(a.ate, 10, "Data final");
  if (!ate.ok) return ate;
  if (de.value && !isDate(de.value)) return fail("Data inicial inválida. Use AAAA-MM-DD.");
  if (ate.value && !isDate(ate.value)) return fail("Data final inválida. Use AAAA-MM-DD.");
  if (!de.value && !ate.value) return ok({});
  const from = de.value ?? addDays(ate.value!, -CONSULTA_DEFAULT_DAYS);
  const to = ate.value ?? (from <= today ? today : addDays(from, CONSULTA_DEFAULT_DAYS));
  if (to < from) return fail("A data final é antes da inicial.");
  if (diffDays(from, to) > CONSULTA_MAX_DAYS) return fail(`Período longo demais (máximo ${CONSULTA_MAX_DAYS} dias).`);
  return ok({ de: from, ate: to });
}

function optMes(v: unknown): Result<string | undefined> {
  const r = optText(v, 7, "Mês");
  if (!r.ok) return r;
  if (r.value && !MONTH_RE.test(r.value)) return fail("Mês inválido. Use AAAA-MM.");
  return ok(r.value);
}

export type ConsultarFinancasArgs = { secao: FinSecao; mes?: string; de?: string; ate?: string; busca?: string; categoria?: string };

/**
 * consultar_financas: seção (padrão periodo), mês AAAA-MM (padrão o atual) ou de/até (só em periodo), busca na descrição
 * e categoria (nome; só em periodo, casada sem acento/caixa com as categorias da família no servidor).
 */
export function parseConsultarFinancasArgs(args: unknown, today: string = todaySP()): Result<ConsultarFinancasArgs> {
  const a = obj(args);
  const secao = parseSecao(a.secao, FIN_SECOES, "periodo");
  if (!secao.ok) return secao;
  const mes = optMes(a.mes);
  if (!mes.ok) return mes;
  const per = parsePeriodo(a, today);
  if (!per.ok) return per;
  const busca = optText(a.busca, LIMITS.search, "Busca");
  if (!busca.ok) return busca;
  const categoria = optText(a.categoria, LIMITS.name, "Categoria");
  if (!categoria.ok) return categoria;
  return ok({ secao: secao.value, mes: mes.value, ...per.value, busca: busca.value, ...(categoria.value ? { categoria: categoria.value } : {}) });
}

/* ---------- Análise (Groq, com fallback no Gemini) ---------- */

export const ANALISAR_ABAS = ["financas", "saude", "casa", "pet", "igreja", "agenda"] as const;
export type AnalisarAba = (typeof ANALISAR_ABAS)[number];
export type AnalisarArgs = { pergunta: string; abas: AnalisarAba[]; mes?: string; de?: string; ate?: string };
/** Sem `abas`: tudo menos Saúde (dados de saúde só vão para a IA de análise quando pedidos explicitamente). */
export const ANALISAR_ABAS_PADRAO: readonly AnalisarAba[] = ["financas", "casa", "pet", "igreja", "agenda"];

/**
 * analisar: pergunta obrigatória (limpa como no ler_arquivo, até 500), abas opcionais (padrão: ANALISAR_ABAS_PADRAO, sem saúde; sem acento/caixa,
 * repetidas saem) e mes/de/ate com as mesmas regras de período das consultas.
 */
export function parseAnalisarArgs(args: unknown, today: string = todaySP()): Result<AnalisarArgs> {
  const a = obj(args);
  const pergunta = cleanPergunta(a.pergunta);
  if (!pergunta) return fail("Pergunta é obrigatória.");
  let abas: AnalisarAba[] = [...ANALISAR_ABAS_PADRAO];
  if (a.abas !== undefined && a.abas !== null) {
    const raw = typeof a.abas === "string" ? [a.abas] : a.abas;
    if (!Array.isArray(raw) || raw.length > ANALISAR_ABAS.length * 2) return fail(`Abas inválidas. Use: ${ANALISAR_ABAS.join(", ")}.`);
    const list: AnalisarAba[] = [];
    for (const v of raw) {
      const n = typeof v === "string" && v.length <= 20 ? normalizeName(v) : "";
      if (!(ANALISAR_ABAS as readonly string[]).includes(n)) return fail(`Aba inválida. Use: ${ANALISAR_ABAS.join(", ")}.`);
      if (!list.includes(n as AnalisarAba)) list.push(n as AnalisarAba);
    }
    if (list.length) abas = list;
  }
  const mes = optMes(a.mes);
  if (!mes.ok) return mes;
  const per = parsePeriodo(a, today);
  if (!per.ok) return per;
  return ok({ pergunta, abas, ...(mes.value ? { mes: mes.value } : {}), ...per.value });
}

export type ConsultarSaudeArgs = { secao: SaudeSecao; pessoa?: string; busca?: string; de?: string; ate?: string };

export function parseConsultarSaudeArgs(args: unknown, today: string = todaySP()): Result<ConsultarSaudeArgs> {
  const a = obj(args);
  const secao = parseSecao(a.secao, SAUDE_SECOES, "resumo");
  if (!secao.ok) return secao;
  const pessoa = optText(a.pessoa, LIMITS.name, "Pessoa");
  if (!pessoa.ok) return pessoa;
  const busca = optText(a.busca, LIMITS.search, "Busca");
  if (!busca.ok) return busca;
  const per = parsePeriodo(a, today);
  if (!per.ok) return per;
  return ok({ secao: secao.value, pessoa: pessoa.value, busca: busca.value, ...per.value });
}

export type ConsultarExamesLabArgs = { pessoa?: string; biomarcador?: string; de?: string; ate?: string };

/** consultar_exames_lab: pessoa, exame (texto livre) e período de/até (sem limite de dias: a evolução vai de anos). */
export function parseConsultarExamesLabArgs(args: unknown): Result<ConsultarExamesLabArgs> {
  const a = obj(args);
  const pessoa = optText(a.pessoa, LIMITS.name, "Pessoa");
  if (!pessoa.ok) return pessoa;
  const biomarcador = optText(a.biomarcador, LIMITS.search, "Exame");
  if (!biomarcador.ok) return biomarcador;
  const de = optText(a.de, 10, "Data inicial");
  if (!de.ok) return de;
  const ate = optText(a.ate, 10, "Data final");
  if (!ate.ok) return ate;
  if (de.value && !isDate(de.value)) return fail("Data inicial inválida. Use AAAA-MM-DD.");
  if (ate.value && !isDate(ate.value)) return fail("Data final inválida. Use AAAA-MM-DD.");
  if (de.value && ate.value && de.value > ate.value) return fail("A data inicial vem depois da final.");
  return ok({ pessoa: pessoa.value, biomarcador: biomarcador.value, de: de.value, ate: ate.value });
}

export type ConsultarCasaArgs = { secao: CasaSecao; busca?: string; data?: string };

export function parseConsultarCasaArgs(args: unknown): Result<ConsultarCasaArgs> {
  const a = obj(args);
  const secao = parseSecao(a.secao, CASA_SECOES, "resumo");
  if (!secao.ok) return secao;
  const busca = optText(a.busca, LIMITS.search, "Busca");
  if (!busca.ok) return busca;
  const data = optText(a.data, 10, "Data");
  if (!data.ok) return data;
  if (data.value && !isDate(data.value)) return fail("Data inválida. Use AAAA-MM-DD.");
  return ok({ secao: secao.value, busca: busca.value, data: data.value });
}

export type ConsultarPetArgs = { secao: PetSecao; pet?: string };

export function parseConsultarPetArgs(args: unknown): Result<ConsultarPetArgs> {
  const a = obj(args);
  const secao = parseSecao(a.secao, PET_SECOES, "resumo");
  if (!secao.ok) return secao;
  const pet = optText(a.pet, LIMITS.name, "Pet");
  if (!pet.ok) return pet;
  return ok({ secao: secao.value, pet: pet.value });
}

export type ConsultarIgrejaArgs = { secao: IgrejaSecao; busca?: string; aula?: string };

/** consultar_igreja: `aula` (id de consultar_igreja secao carisma) traz anotações, resumo e arquivos da aula. */
export function parseConsultarIgrejaArgs(args: unknown): Result<ConsultarIgrejaArgs> {
  const a = obj(args);
  const secao = parseSecao(a.secao, IGREJA_SECOES, a.aula ? "carisma" : "resumo");
  if (!secao.ok) return secao;
  const busca = optText(a.busca, LIMITS.search, "Busca");
  if (!busca.ok) return busca;
  let aula: string | undefined;
  if (a.aula !== undefined && a.aula !== null && a.aula !== "") {
    if (typeof a.aula !== "string" || !UUID_RE.test(a.aula.trim())) return fail("Id de aula inválido.");
    aula = a.aula.trim().toLowerCase();
  }
  return ok({ secao: secao.value, busca: busca.value, aula });
}

export function parseBuscarNoAppArgs(args: unknown): Result<{ busca: string }> {
  const busca = reqText(obj(args).busca, LIMITS.search, "Busca");
  if (!busca.ok) return busca;
  if (busca.value.length < BUSCA_MIN) return fail("Busca muito curta.");
  return ok({ busca: busca.value });
}

/**
 * Arquivos guardados que o Oli pode ler. O id vem das consultas como "<tipo>:<uuid>"; o tipo é uma lista
 * fechada (decide tabela e bucket no servidor), o uuid é conferido no formato.
 */
export const ARQUIVO_TIPOS = [
  "exame",
  "carteirinha",
  "procedimento",
  "vacina",
  "casa_documento",
  "pet_saude",
  "pet_veterinario",
  "financas",
  "carisma",
] as const;
export type ArquivoTipo = (typeof ARQUIVO_TIPOS)[number];
export type ArquivoRef = { tipo: ArquivoTipo; id: string };

export const arquivoRef = (tipo: ArquivoTipo, id: string) => `${tipo}:${id}`;

export function parseArquivoRef(v: unknown): ArquivoRef | null {
  if (typeof v !== "string" || v.length > 60) return null;
  const m = /^([a-z_]+):([0-9a-f-]{36})$/i.exec(v.trim());
  if (!m) return null;
  const tipo = m[1].toLowerCase();
  if (!(ARQUIVO_TIPOS as readonly string[]).includes(tipo) || !UUID_RE.test(m[2])) return null;
  return { tipo: tipo as ArquivoTipo, id: m[2].toLowerCase() };
}

export const PERGUNTA_MAX = 500;

/**
 * Pergunta do usuário sobre o arquivo (opcional): uma linha, sem caracteres de controle, marcas de direção
 * nem < > (não abre nem fecha os blocos marcados do pedido), cortada em 500. Vazia ou de outro tipo → undefined.
 */
export function cleanPergunta(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return undefined;
  return t.length > PERGUNTA_MAX ? t.slice(0, PERGUNTA_MAX).trimEnd() : t;
}

export type LerArquivoArgs = ArquivoRef & { pergunta?: string };

export function parseLerArquivoArgs(args: unknown): Result<LerArquivoArgs> {
  const a = obj(args);
  const ref = parseArquivoRef(a.id);
  if (!ref) return fail("Id de arquivo inválido. Use o id que veio da consulta (ex.: exame:…).");
  const pergunta = cleanPergunta(a.pergunta);
  return ok(pergunta ? { ...ref, pergunta } : ref);
}

/** ler_ultimo_arquivo: só a pergunta (opcional), com a mesma limpeza do ler_arquivo. O arquivo vem da tela. */
export function parseLerUltimoArquivoArgs(args: unknown): Result<{ pergunta?: string }> {
  const pergunta = cleanPergunta(obj(args).pergunta);
  return ok(pergunta ? { pergunta } : {});
}
