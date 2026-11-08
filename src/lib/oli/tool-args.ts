/**
 * Validação dos argumentos que o modelo manda para as ferramentas do Oli.
 * Roda no servidor (server actions). Erro vira { erro } curto, que volta ao modelo.
 */
import { MAX_AMOUNT, UUID_RE, validDate } from "@/lib/financas/transaction-input";

export const OLI_TOOL_NAMES = [
  "resumo_do_mes",
  "saldo_das_contas",
  "contas_a_pagar",
  "ultimos_lancamentos",
  "criar_lancamento",
  "salvar_memoria",
  "consultar_memoria",
  "esquecer_memoria",
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
