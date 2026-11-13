/**
 * Leitura total do Oli: monta, a partir das linhas do banco (já filtradas pelo RLS da sessão), os dados
 * resumidos que voltam ao modelo e alimentam o painel. Funções puras (testadas sem banco).
 * Regras:
 * - Só campos úteis para responder; nunca tokens, caminhos de arquivo, ids de terceiros (Drive, Pluggy) ou chaves.
 * - Textos vindos do banco passam por cleanText (sem caracteres de controle, tamanho limitado): são DADOS.
 * - Listas limitadas (MAX_ITENS por grupo); `total` diz quantos havia antes do corte.
 * - Arquivo guardado vira só uma referência "<tipo>:<uuid>" para ler_arquivo.
 */
import { cleanText } from "@/lib/financas/documentos/schema";
import { brDate, diffDays, toSpDate, toSpTime } from "@/lib/agenda/dates";
import { goalProgress, resolveBudgets, billStatus, type BudgetRow, type BillStatus } from "@/lib/financas/planning";
import { monthLabel } from "@/lib/financas/period";
import { summarize } from "@/lib/financas/summary";
import type { Account, Category, Goal, Transaction } from "@/lib/financas/types";
import { warrantyStatus } from "@/lib/casa/docs";
import { DOC_KIND_LABEL, MEAL_LABEL, type Meal } from "@/lib/casa/types";
import { currentResponsible } from "@/lib/casa/schedule";
import { PET_HEALTH_LABEL, PET_VET_LABEL, SPECIES_LABEL, type PetHealthKind, type PetVetKind, type Species } from "@/lib/casa/pet";
import { PURPOSE_STATUS_LABEL, type PurposeStatus } from "@/lib/igreja/input";
import { arquivoRef, normalizeName, type ArquivoTipo } from "./tool-args";

export const MAX_ITENS = 15;
export const MAX_TEXTO = 300;
export const MAX_TEXTO_LONGO = 1500;

export type ConsultaAba = "financas" | "saude" | "casa" | "pet" | "igreja" | "busca";

export type ConsultaItem = {
  titulo: string;
  /** AAAA-MM-DD (São Paulo) principal do item, quando houver. */
  data: string | null;
  pessoa: string | null;
  status: string | null;
  valor: number | null;
  /** Linhas "Rótulo: valor" já resumidas. */
  detalhes: string[];
  /** Referência para ler_arquivo ("exame:uuid"); null se não há arquivo. */
  arquivo: string | null;
  /** Id do item (Casa, Pet e Igreja): para alterar_<aba> e para abrir a aula do Carisma. */
  id?: string;
};
export type ConsultaGrupo = { titulo: string; total: number; itens: ConsultaItem[] };
export type ConsultaData = {
  aba: ConsultaAba;
  secao: string;
  titulo: string;
  periodo: string | null;
  grupos: ConsultaGrupo[];
  /** Mensagem curta quando não há dado ou algo ficou de fora. */
  aviso: string | null;
};

/* ---------- Utilitários ---------- */

export const txt = (v: unknown, max = MAX_TEXTO) => cleanText(v, max);

type ItemOpts = Partial<Omit<ConsultaItem, "titulo" | "detalhes">> & { detalhes?: (string | null | false | undefined)[] };

/** Item com só o que veio preenchido. */
export function item(titulo: unknown, o: ItemOpts = {}): ConsultaItem {
  return {
    titulo: txt(titulo, 160) ?? "Sem título",
    data: o.data ?? null,
    pessoa: o.pessoa ?? null,
    status: o.status ?? null,
    valor: typeof o.valor === "number" && Number.isFinite(o.valor) ? o.valor : null,
    detalhes: (o.detalhes ?? []).filter((d): d is string => typeof d === "string" && d.length > 0),
    arquivo: o.arquivo ?? null,
    ...(o.id ? { id: o.id } : {}),
  };
}

/** "Rótulo: valor" só se o valor existir (texto limpo e truncado). */
export function det(label: string, v: unknown, max = MAX_TEXTO): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? `${label}: ${v}` : null;
  const t = txt(v, max);
  return t ? `${label}: ${t}` : null;
}

export function grupo(titulo: string, itens: ConsultaItem[], max = MAX_ITENS): ConsultaGrupo {
  return { titulo, total: itens.length, itens: itens.slice(0, max) };
}

export function consulta(
  aba: ConsultaAba,
  secao: string,
  titulo: string,
  grupos: ConsultaGrupo[],
  extra: { periodo?: string | null; aviso?: string | null } = {},
): ConsultaData {
  const vazio = grupos.every((g) => g.total === 0);
  return {
    aba,
    secao,
    titulo,
    periodo: extra.periodo ?? null,
    grupos: grupos.filter((g) => g.total > 0),
    aviso: extra.aviso ?? (vazio ? "Nada encontrado." : null),
  };
}

/** Lista cortada pelo limite da consulta: quantos vieram e quantos existem no banco (count exato). */
export type Corte = { rotulo: string; mostrados: number; total: number };

/** Acrescenta o aviso de lista incompleta (o modelo não pode tratar a lista cortada como completa). */
export function comCorte(d: ConsultaData, cortes: Corte[]): ConsultaData {
  if (!cortes.length) return d;
  const note = `Lista incompleta: ${cortes.map((c) => `${c.rotulo}: ${c.mostrados} de ${c.total}`).join("; ")}. Use busca ou um período menor para ver o resto.`;
  return { ...d, aviso: d.aviso && d.aviso !== "Nada encontrado." ? `${d.aviso} ${note}` : note };
}

export const FIN_INCOMPLETO =
  "Lista incompleta: há lançamentos demais neste período para somar com segurança; os totais não foram calculados. Peça um período menor.";

const ref = (tipo: ArquivoTipo, id: string, temArquivo: boolean) => (temArquivo ? arquivoRef(tipo, id) : null);

/** Filtro de busca (sem acento/caixa) em qualquer um dos campos. */
export function matches(busca: string | undefined, ...fields: unknown[]) {
  if (!busca) return true;
  const q = normalizeName(busca);
  return fields.some((f) => typeof f === "string" && normalizeName(f).includes(q));
}

/** Número da carteirinha só com os 4 últimos dígitos (é falado em voz alta; o completo fica na tela de Saúde). */
export function maskCardNumber(v: string | null | undefined): string | null {
  const digits = (v ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length <= 4 ? "••••" : `final ${digits.slice(-4)}`;
}

type Names = Map<string, string>;
type People = { user_id: string | null; name: string }[];

/* ---------- Finanças ---------- */

const BILL_STATUS_LABEL: Record<BillStatus, string> = { paga: "paga", atrasada: "atrasada", vence_hoje: "vence hoje", a_vencer: "a vencer" };

export function buildFinPeriodo(input: {
  de: string;
  ate: string;
  rotulo: string;
  txs: Transaction[];
  accounts: Account[];
  categories: Category[];
  busca?: string;
  /** false: a consulta não trouxe todos os lançamentos do período → sem totais e com aviso. */
  completo?: boolean;
}): ConsultaData {
  const { txs, accounts, categories } = input;
  const completo = input.completo !== false;
  const cardIds = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const { income, expense, result, expenseByCategory } = summarize(txs, categories, cardIds);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const accById = new Map(accounts.map((a) => [a.id, a.name]));
  const totais = item("Totais do período", {
    valor: result,
    detalhes: [`Entradas: ${income}`, `Saídas: ${expense}`, `Saldo: ${result}`, `Lançamentos: ${txs.length}`],
  });
  const cats = expenseByCategory.map(({ category_id, total }) =>
    item(category_id ? (catById.get(category_id)?.name ?? "Sem categoria") : "Sem categoria", { valor: total }),
  );
  const lanc = txs.map((t) =>
    item(t.description, {
      data: t.date,
      valor: t.amount,
      detalhes: [det("Categoria", t.category_id ? catById.get(t.category_id)?.name : "Sem categoria"), det("Conta", accById.get(t.account_id))],
    }),
  );
  return consulta(
    "financas",
    "periodo",
    input.busca ? `Finanças: “${input.busca}” em ${input.rotulo}` : `Finanças de ${input.rotulo}`,
    completo
      ? [grupo("Resumo", txs.length ? [totais] : []), grupo("Gastos por categoria", cats, 8), grupo("Lançamentos", lanc)]
      : [grupo("Lançamentos", lanc)],
    { periodo: `${input.de} a ${input.ate}`, aviso: completo ? undefined : FIN_INCOMPLETO },
  );
}

export function buildFinMetas(goals: Goal[], accounts: Account[], today: string): ConsultaData {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const itens = goals.map((g) => {
    const a = g.account_id ? acc.get(g.account_id) : undefined;
    const p = goalProgress(a?.balance ?? 0, g.target, g.target_date, today);
    return item(g.name, {
      data: g.target_date,
      valor: g.target,
      status: p.remaining === 0 ? "atingida" : `${Math.round(p.pct * 100)}%`,
      detalhes: [
        `Guardado: ${p.saved}`,
        `Falta: ${p.remaining}`,
        a ? det("Conta", a.name) : "Conta: sem conta vinculada",
        p.perMonth !== null && p.remaining > 0 ? `Guardar por mês: ${p.perMonth}` : null,
      ],
    });
  });
  return consulta("financas", "metas", "Metas", [grupo("Metas", itens)]);
}

export function buildFinOrcamento(month: string, rows: BudgetRow[], txs: Transaction[], categories: Category[], accounts: Account[]): ConsultaData {
  const cards = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const spent = new Map(summarize(txs, categories, cards).expenseByCategory.map((e) => [e.category_id, e.total]));
  const budgets = resolveBudgets(rows, month);
  const cents = (v: number) => Math.round(v * 100);
  let totalBudget = 0;
  let totalSpent = 0;
  const itens = categories
    .filter((c) => c.kind === "despesa" && budgets.has(c.id))
    .map((c) => {
      const b = budgets.get(c.id)!.amount;
      const s = spent.get(c.id) ?? 0;
      totalBudget += cents(b);
      totalSpent += cents(s);
      const rest = (cents(b) - cents(s)) / 100;
      return item(c.name, { valor: b, status: rest < 0 ? "estourado" : "dentro", detalhes: [`Orçado: ${b}`, `Gasto: ${s}`, `Restante: ${rest}`] });
    });
  const resumo = itens.length
    ? [item("Total com orçamento", { valor: totalBudget / 100, detalhes: [`Orçado: ${totalBudget / 100}`, `Gasto: ${totalSpent / 100}`] })]
    : [];
  return consulta("financas", "orcamento", `Orçamento de ${monthLabel(month)}`, [grupo("Resumo", resumo), grupo("Categorias", itens, 20)], {
    periodo: month,
    aviso: itens.length ? null : "Nenhum orçamento definido para este mês.",
  });
}

export function buildFinContasFixas(
  month: string,
  contas: { nome: string; valor: number; vencimento: string; status: BillStatus; fatura: boolean }[],
): ConsultaData {
  const itens = contas.map((c) => item(c.fatura ? `Fatura ${c.nome}` : c.nome, { data: c.vencimento, valor: c.valor, status: BILL_STATUS_LABEL[c.status] }));
  return consulta("financas", "contas_fixas", `Contas fixas de ${monthLabel(month)}`, [grupo("Contas", itens, 25)], { periodo: month });
}

export function buildFinAvulsas(
  month: string,
  list: { name: string; amount: number; due_date: string; paid_on: string | null; is_home?: boolean }[],
  today: string,
): ConsultaData {
  const itens = list.map((o) =>
    item(o.name, {
      data: o.due_date,
      valor: o.amount,
      status: BILL_STATUS_LABEL[billStatus(o.due_date, Boolean(o.paid_on), today)],
      detalhes: [o.paid_on ? `Paga em: ${brDate(o.paid_on)}` : null, o.is_home ? "Conta da casa" : null],
    }),
  );
  return consulta("financas", "contas_avulsas", `Contas avulsas de ${monthLabel(month)}`, [grupo("Contas avulsas", itens, 25)], { periodo: month });
}

const CAT_KIND: Record<string, string> = { despesa: "Despesas", receita: "Receitas", transferencia: "Transferências" };

export function buildFinCategorias(month: string, categories: Category[], txs: Transaction[], accounts: Account[]): ConsultaData {
  const cards = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const spent = new Map(summarize(txs, categories, cards).expenseByCategory.map((e) => [e.category_id, e.total]));
  const by = (kind: string) =>
    categories.filter((c) => c.kind === kind).map((c) => item(c.name, { valor: kind === "despesa" ? (spent.get(c.id) ?? 0) : null }));
  return consulta(
    "financas",
    "categorias",
    `Categorias (gastos de ${monthLabel(month)})`,
    ["despesa", "receita", "transferencia"].map((k) => grupo(CAT_KIND[k], by(k), 40)),
    { periodo: month },
  );
}

/* ---------- Saúde (compartilhada entre os adultos da família, como nas telas de Saúde) ---------- */

export type SaudeRows = {
  consultas?: { id: string; member_id: string; kind: string; specialty: string | null; doctor: string | null; place: string | null; starts_at: string; status: string; notes: string | null }[];
  exames?: { id: string; member_id: string; name: string; exam_date: string | null; lab: string | null; requested_by: string | null; result_summary: string | null; file_path: string | null }[];
  vacinas?: { id: string; member_id: string; name: string; dose_label: string | null; applied_on: string | null; next_dose_on: string | null; place: string | null; file_path: string | null }[];
  procedimentos?: { id: string; member_id: string; name: string; performed_on: string | null; place: string | null; doctor: string | null; notes: string | null; file_path: string | null }[];
  medicamentos?: {
    id: string;
    member_id: string;
    name: string;
    dosage: string | null;
    frequency: string | null;
    started_on: string | null;
    ended_on: string | null;
    active: boolean;
    prescribed_by: string | null;
    reminder_times?: string[] | null;
  }[];
  carteirinhas?: { id: string; member_id: string; operator: string; card_number: string | null; plan_name: string | null; valid_until: string | null; file_path: string | null }[];
};

const APPT_STATUS: Record<string, string> = { agendada: "agendada", realizada: "realizada", cancelada: "cancelada" };

export function saudeItens(rows: SaudeRows, names: Names, busca?: string) {
  const who = (id: string) => names.get(id) ?? null;
  return {
    consultas: (rows.consultas ?? [])
      .filter((c) => matches(busca, c.specialty, c.doctor, c.place, c.notes))
      .map((c) =>
        item([c.kind === "retorno" ? "Retorno" : "Consulta", c.specialty].filter(Boolean).join(" · "), {
          data: toSpDate(c.starts_at),
          pessoa: who(c.member_id),
          status: APPT_STATUS[c.status] ?? null,
          detalhes: [`Horário: ${toSpTime(c.starts_at)}`, det("Médico", c.doctor), det("Local", c.place), det("Observações", c.notes)],
        }),
      ),
    exames: (rows.exames ?? [])
      .filter((e) => matches(busca, e.name, e.lab, e.requested_by, e.result_summary))
      .map((e) =>
        item(e.name, {
          data: e.exam_date,
          pessoa: who(e.member_id),
          detalhes: [det("Laboratório", e.lab), det("Pedido por", e.requested_by), det("Resultado anotado", e.result_summary)],
          arquivo: ref("exame", e.id, Boolean(e.file_path)),
        }),
      ),
    vacinas: (rows.vacinas ?? [])
      .filter((v) => matches(busca, v.name, v.place))
      .map((v) =>
        item(v.name, {
          data: v.applied_on,
          pessoa: who(v.member_id),
          detalhes: [det("Dose", v.dose_label), v.next_dose_on ? `Próxima dose: ${brDate(v.next_dose_on)}` : null, det("Local", v.place)],
          arquivo: ref("vacina", v.id, Boolean(v.file_path)),
        }),
      ),
    procedimentos: (rows.procedimentos ?? [])
      .filter((p) => matches(busca, p.name, p.place, p.doctor, p.notes))
      .map((p) =>
        item(p.name, {
          data: p.performed_on,
          pessoa: who(p.member_id),
          detalhes: [det("Local", p.place), det("Médico", p.doctor), det("Observações", p.notes)],
          arquivo: ref("procedimento", p.id, Boolean(p.file_path)),
        }),
      ),
    medicamentos: (rows.medicamentos ?? [])
      .filter((m) => matches(busca, m.name, m.prescribed_by))
      .map((m) =>
        item(m.name, {
          data: m.started_on,
          pessoa: who(m.member_id),
          status: m.active ? "em uso" : "encerrado",
          detalhes: [
            det("Dosagem", m.dosage),
            det("Frequência", m.frequency),
            m.reminder_times?.length ? `Horários: ${m.reminder_times.slice(0, 6).join(", ")}` : null,
            m.ended_on ? `Até: ${brDate(m.ended_on)}` : null,
            det("Prescrito por", m.prescribed_by),
          ],
        }),
      ),
    carteirinhas: (rows.carteirinhas ?? [])
      .filter((c) => matches(busca, c.operator, c.plan_name))
      .map((c) =>
        item(c.operator, {
          pessoa: who(c.member_id),
          data: c.valid_until,
          detalhes: [det("Plano", c.plan_name), det("Número", maskCardNumber(c.card_number)), c.valid_until ? `Validade: ${brDate(c.valid_until)}` : null],
          arquivo: ref("carteirinha", c.id, Boolean(c.file_path)),
        }),
      ),
  };
}

const SAUDE_TITULO: Record<string, string> = {
  consultas: "Consultas",
  exames: "Exames",
  vacinas: "Vacinas",
  procedimentos: "Procedimentos",
  medicamentos: "Medicamentos",
  carteirinhas: "Carteirinhas",
};

export function buildSaude(
  secao: string,
  rows: SaudeRows,
  names: Names,
  opts: { busca?: string; pessoa?: string | null; today: string; periodo?: string | null },
): ConsultaData {
  const all = saudeItens(rows, names, opts.busca);
  const sufixo = opts.pessoa ? ` de ${opts.pessoa}` : "";
  if (secao === "resumo") {
    const proximas = all.consultas
      .filter((c) => c.status === "agendada" && (c.data ?? "") >= opts.today)
      .sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
    const doses = all.vacinas.filter((v) => v.detalhes.some((d) => d.startsWith("Próxima dose")));
    return consulta("saude", "resumo", `Saúde${sufixo}`, [
      grupo("Próximas consultas", proximas, 5),
      grupo("Medicamentos em uso", all.medicamentos.filter((m) => m.status === "em uso"), 8),
      grupo("Vacinas com próxima dose", doses, 5),
      grupo("Exames recentes", all.exames, 5),
    ]);
  }
  const list = all[secao as keyof typeof all] ?? [];
  return consulta("saude", secao, `${SAUDE_TITULO[secao] ?? "Saúde"}${sufixo}`, [grupo(SAUDE_TITULO[secao] ?? "Itens", list)], {
    periodo: opts.periodo ?? null,
  });
}

/* ---------- Casa ---------- */

export type CasaRows = {
  tarefas?: { id: string; name: string; notes: string | null; frequency: string; rotation: string[]; next_index: number; next_due_on: string | null; active: boolean }[];
  compras?: { id: string; name: string; quantity: number | null; unit: string | null; category: string | null; notes: string | null; done: boolean }[];
  manutencao?: {
    id: string;
    name: string;
    notes: string | null;
    interval_value: number;
    interval_unit: string;
    last_done_on: string | null;
    next_due_on: string | null;
    provider: string | null;
    active: boolean;
  }[];
  documentos?: {
    id: string;
    kind: string;
    title: string;
    product: string | null;
    store: string | null;
    purchase_date: string | null;
    warranty_until: string | null;
    amount: number | null;
    notes: string | null;
    file_path: string | null;
  }[];
  cardapio?: { id: string; day: string; meal: string; title: string; ingredients: string[]; notes: string | null }[];
  prestadores?: { id: string; name: string; service: string | null; phone: string | null; notes: string | null }[];
};

const FREQ: Record<string, string> = { diaria: "diária", semanal: "semanal", mensal: "mensal" };
const MEAL_ORDER: Record<string, number> = { cafe: 0, almoco: 1, lanche: 2, jantar: 3 };
const WARRANTY: Record<string, string> = { vencida: "garantia vencida", vencendo: "garantia vencendo", valida: "garantia válida" };

export function casaItens(rows: CasaRows, names: Names, today: string, busca?: string) {
  const valid = new Set(names.keys());
  const dueStatus = (d: string | null) => (!d ? null : d < today ? "atrasada" : d === today ? "hoje" : null);
  return {
    tarefas: (rows.tarefas ?? [])
      .filter((t) => t.active && matches(busca, t.name, t.notes))
      .sort((a, b) => (a.next_due_on ?? "9999").localeCompare(b.next_due_on ?? "9999"))
      .map((t) => {
        const resp = currentResponsible({ rotation: t.rotation ?? [], next_index: t.next_index ?? 0 }, valid);
        return item(t.name, {
          id: t.id,
          data: t.next_due_on,
          pessoa: resp ? (names.get(resp) ?? null) : null,
          status: dueStatus(t.next_due_on),
          detalhes: [`Frequência: ${FREQ[t.frequency] ?? t.frequency}`, det("Notas", t.notes)],
        });
      }),
    compras: (rows.compras ?? [])
      .filter((c) => !c.done && matches(busca, c.name, c.category, c.notes))
      .map((c) =>
        item(c.name, {
          id: c.id,
          detalhes: [
            c.quantity ? `Quantidade: ${c.quantity}${c.unit ? ` ${txt(c.unit, 20)}` : ""}` : null,
            det("Categoria", c.category, 40),
            det("Notas", c.notes),
          ],
        }),
      ),
    manutencao: (rows.manutencao ?? [])
      .filter((m) => m.active && matches(busca, m.name, m.notes, m.provider))
      .sort((a, b) => (a.next_due_on ?? "9999").localeCompare(b.next_due_on ?? "9999"))
      .map((m) =>
        item(m.name, {
          id: m.id,
          data: m.next_due_on,
          status: m.next_due_on && m.next_due_on < today ? "atrasada" : null,
          detalhes: [
            `A cada ${m.interval_value} ${m.interval_unit}`,
            m.last_done_on ? `Última vez: ${brDate(m.last_done_on)}` : null,
            det("Prestador", m.provider),
            det("Notas", m.notes),
          ],
        }),
      ),
    documentos: (rows.documentos ?? [])
      .filter((d) => matches(busca, d.title, d.product, d.store, d.notes))
      .map((d) => {
        const w = warrantyStatus(d.warranty_until, today);
        return item(d.title, {
          id: d.id,
          data: d.purchase_date,
          valor: d.amount,
          status: w ? WARRANTY[w] : null,
          detalhes: [
            `Tipo: ${DOC_KIND_LABEL[d.kind as keyof typeof DOC_KIND_LABEL] ?? "Outro"}`,
            det("Produto", d.product),
            det("Loja", d.store),
            d.warranty_until ? `Garantia até: ${brDate(d.warranty_until)}` : null,
            det("Notas", d.notes),
          ],
          arquivo: ref("casa_documento", d.id, Boolean(d.file_path)),
        });
      }),
    cardapio: (rows.cardapio ?? [])
      .filter((m) => matches(busca, m.title, m.notes, ...(m.ingredients ?? [])))
      .sort((a, b) => a.day.localeCompare(b.day) || (MEAL_ORDER[a.meal] ?? 9) - (MEAL_ORDER[b.meal] ?? 9))
      .map((m) =>
        item(m.title, {
          id: m.id,
          data: m.day,
          status: MEAL_LABEL[m.meal as Meal] ?? null,
          detalhes: [
            m.ingredients?.length
              ? `Ingredientes: ${m.ingredients
                  .slice(0, 15)
                  .map((i) => txt(i, 60))
                  .filter(Boolean)
                  .join(", ")}`
              : null,
            det("Notas", m.notes),
          ],
        }),
      ),
    prestadores: (rows.prestadores ?? [])
      .filter((p) => matches(busca, p.name, p.service, p.notes))
      .map((p) => item(p.name, { id: p.id, detalhes: [det("Serviço", p.service, 80), det("Telefone", p.phone, 30), det("Notas", p.notes)] })),
  };
}

const CASA_TITULO: Record<string, string> = {
  tarefas: "Tarefas",
  compras: "Lista de compras",
  manutencao: "Manutenção",
  documentos: "Documentos da casa",
  cardapio: "Cardápio da semana",
  prestadores: "Prestadores",
};

export function buildCasa(secao: string, rows: CasaRows, names: Names, opts: { today: string; busca?: string; periodo?: string | null }): ConsultaData {
  const all = casaItens(rows, names, opts.today, opts.busca);
  if (secao === "resumo") {
    return consulta("casa", "resumo", "Casa", [
      grupo("Tarefas para hoje ou atrasadas", all.tarefas.filter((t) => t.status), 8),
      grupo("Compras pendentes", all.compras, 8),
      grupo("Manutenções nos próximos 30 dias", all.manutencao.filter((m) => m.data && diffDays(opts.today, m.data) <= 30), 5),
      grupo("Garantias vencendo", all.documentos.filter((d) => d.status === "garantia vencendo"), 5),
    ]);
  }
  const list = all[secao as keyof typeof all] ?? [];
  const max = secao === "compras" || secao === "cardapio" ? 30 : MAX_ITENS;
  return consulta("casa", secao, CASA_TITULO[secao] ?? "Casa", [grupo(CASA_TITULO[secao] ?? "Itens", list, max)], { periodo: opts.periodo ?? null });
}

/* ---------- Pet ---------- */

export type PetRows = {
  pets: { id: string; name: string; species: string; breed: string | null; sex: string | null; birth_date: string | null; notes: string | null }[];
  saude?: { id: string; pet_id: string; kind: string; name: string; dose: string | null; applied_on: string | null; next_due_on: string | null; notes: string | null; file_path: string | null }[];
  veterinario?: {
    id: string;
    pet_id: string;
    kind: string;
    happened_on: string;
    clinic: string | null;
    vet: string | null;
    reason: string | null;
    notes: string | null;
    cost: number | null;
    file_path: string | null;
  }[];
  cuidados?: {
    id: string;
    pet_id: string;
    name: string;
    interval_value: number;
    interval_unit: string;
    last_done_on: string | null;
    next_due_on: string | null;
    active: boolean;
    notes: string | null;
  }[];
  peso?: { id: string; pet_id: string; measured_on: string; weight_kg: number }[];
  racao?: { id: string; pet_id: string; brand: string; bag_kg: number; daily_grams: number | null; started_on: string; active: boolean; notes: string | null }[];
};

/** Idade em anos (ou meses, abaixo de 1 ano) a partir de AAAA-MM-DD. */
export function idade(birth: string | null, today: string): string | null {
  if (!birth) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) months = 0;
  return months >= 12 ? `${Math.floor(months / 12)} ano(s)` : `${months} mês(es)`;
}

export function buildPet(secao: string, rows: PetRows, today: string): ConsultaData {
  const petName = new Map(rows.pets.map((p) => [p.id, p.name]));
  const pn = (id: string) => petName.get(id) ?? null;
  const saudeRows = rows.saude ?? [];
  const saude = saudeRows.map((h) =>
    item(`${PET_HEALTH_LABEL[h.kind as PetHealthKind] ?? "Saúde"}: ${txt(h.name, 120) ?? ""}`, {
      id: h.id,
      data: h.applied_on,
      pessoa: pn(h.pet_id),
      status: h.next_due_on && h.next_due_on < today ? "atrasada" : null,
      detalhes: [det("Dose", h.dose, 60), h.next_due_on ? `Próxima: ${brDate(h.next_due_on)}` : null, det("Notas", h.notes)],
      arquivo: ref("pet_saude", h.id, Boolean(h.file_path)),
    }),
  );
  const vet = (rows.veterinario ?? []).map((v) =>
    item(`${PET_VET_LABEL[v.kind as PetVetKind] ?? "Veterinário"}${v.reason ? `: ${txt(v.reason, 120)}` : ""}`, {
      id: v.id,
      data: v.happened_on,
      pessoa: pn(v.pet_id),
      valor: v.cost,
      detalhes: [det("Clínica", v.clinic), det("Veterinário", v.vet), det("Notas", v.notes)],
      arquivo: ref("pet_veterinario", v.id, Boolean(v.file_path)),
    }),
  );
  const cuidados = (rows.cuidados ?? [])
    .filter((c) => c.active)
    .map((c) =>
      item(c.name, {
        id: c.id,
        data: c.next_due_on,
        pessoa: pn(c.pet_id),
        status: c.next_due_on && c.next_due_on < today ? "atrasado" : null,
        detalhes: [`A cada ${c.interval_value} ${c.interval_unit}`, c.last_done_on ? `Última vez: ${brDate(c.last_done_on)}` : null, det("Notas", c.notes)],
      }),
    );
  const peso = (rows.peso ?? []).map((w) => item(`${w.weight_kg} kg`, { id: w.id, data: w.measured_on, pessoa: pn(w.pet_id) }));
  const racao = (rows.racao ?? []).map((f) =>
    item(f.brand, {
      id: f.id,
      data: f.started_on,
      pessoa: pn(f.pet_id),
      status: f.active ? "em uso" : "anterior",
      detalhes: [`Pacote: ${f.bag_kg} kg`, f.daily_grams ? `Por dia: ${f.daily_grams} g` : null, det("Notas", f.notes)],
    }),
  );
  const pets = rows.pets.map((p) =>
    item(p.name, {
      detalhes: [
        `Espécie: ${SPECIES_LABEL[p.species as Species] ?? "Outro"}`,
        det("Raça", p.breed, 60),
        p.sex ? `Sexo: ${p.sex === "femea" ? "fêmea" : "macho"}` : null,
        p.birth_date ? `Idade: ${idade(p.birth_date, today)}` : null,
        det("Notas", p.notes),
      ],
    }),
  );
  if (secao === "resumo") {
    // Próximas doses pela data real (da linha), não pelo texto montado.
    const proximas = saudeRows
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.next_due_on)
      .sort((a, b) => a.h.next_due_on!.localeCompare(b.h.next_due_on!))
      .map(({ i }) => saude[i]);
    const seen = new Set<string | null>();
    const ultimoPeso = peso.filter((w) => (seen.has(w.pessoa) ? false : (seen.add(w.pessoa), true)));
    return consulta(
      "pet",
      "resumo",
      "Pet",
      [
        grupo("Pets", pets, 5),
        grupo("Próximas doses", proximas, 6),
        grupo("Cuidados", cuidados, 5),
        grupo("Último peso", ultimoPeso, 5),
        grupo("Ração em uso", racao.filter((r) => r.status === "em uso"), 5),
      ],
      { aviso: rows.pets.length ? null : "Nenhum pet cadastrado." },
    );
  }
  const map: Record<string, [string, ConsultaItem[]]> = {
    saude: ["Saúde do pet", saude],
    veterinario: ["Veterinário", vet],
    cuidados: ["Cuidados", cuidados],
    peso: ["Peso", peso],
    racao: ["Ração", racao],
  };
  const [titulo, list] = map[secao] ?? ["Pets", pets];
  return consulta("pet", secao, titulo, [grupo(titulo, list)]);
}

/* ---------- Igreja (RLS: só o que é da pessoa ou o que o cônjuge compartilhou) ---------- */

type Owned = { owner_id: string; shared: boolean };
export type IgrejaRows = {
  palavras?: (Owned & { id: string; kind: string; title: string | null; body: string; received_on: string; reference: string | null; fulfilled_on: string | null })[];
  oracoes?: (Owned & { id: string; title: string; person: string | null; details: string | null; status: string; answered_on: string | null; answer_notes: string | null })[];
  propositos?: (Owned & { id: string; title: string; description: string | null; status: string; starts_on: string | null; ends_on: string | null; notes: string | null })[];
  aulas?: (Owned & {
    id: string;
    title: string;
    lesson_date: string | null;
    subject: string | null;
    teacher: string | null;
    notes: string | null;
    summary: string | null;
    summary_status: string;
  })[];
  arquivos?: { id: string; lesson_id: string; display_name: string; file_mime: string; status: string }[];
};
export type AulaRow = NonNullable<IgrejaRows["aulas"]>[number];
export type AulaFileRow = NonNullable<IgrejaRows["arquivos"]>[number];

/** De quem é: "você" ou "compartilhado por <nome>". */
function ownerLabel(i: Owned, uid: string, members: People) {
  if (i.owner_id === uid) return "você";
  return `compartilhado por ${members.find((m) => m.user_id === i.owner_id)?.name ?? "alguém da família"}`;
}
/** Defesa extra além do RLS (mesma da tela, withOwnership): item de outra pessoa que não está compartilhado sai. */
export const visibleToMe = <T extends Owned>(list: T[] | undefined, uid: string) => (list ?? []).filter((i) => i.owner_id === uid || i.shared);

export function igrejaItens(rows: IgrejaRows, uid: string, members: People, busca?: string) {
  const files = new Map<string, number>();
  for (const f of rows.arquivos ?? []) if (f.status === "pronto") files.set(f.lesson_id, (files.get(f.lesson_id) ?? 0) + 1);
  const palavras = visibleToMe(rows.palavras, uid).filter((w) => matches(busca, w.title, w.body, w.reference));
  const word = (w: (typeof palavras)[number]) =>
    item(w.title ?? txt(w.body, 60) ?? "Palavra", {
      id: w.id,
      data: w.received_on,
      pessoa: ownerLabel(w, uid, members),
      status: w.kind === "promessa" ? (w.fulfilled_on ? "cumprida" : "aguardando") : null,
      detalhes: [det("Texto", w.body), det("Referência", w.reference, 120), w.fulfilled_on ? `Cumprida em: ${brDate(w.fulfilled_on)}` : null],
    });
  return {
    palavras: palavras.filter((w) => w.kind === "anotacao").map(word),
    promessas: palavras.filter((w) => w.kind === "promessa").map(word),
    oracoes: visibleToMe(rows.oracoes, uid)
      .filter((p) => matches(busca, p.title, p.person, p.details))
      .map((p) =>
        item(p.title, {
          id: p.id,
          pessoa: ownerLabel(p, uid, members),
          status: p.status === "respondida" ? "respondida" : "orando",
          data: p.answered_on,
          detalhes: [det("Por quem", p.person, 120), det("Detalhes", p.details), det("Resposta", p.answer_notes)],
        }),
      ),
    propositos: visibleToMe(rows.propositos, uid)
      .filter((p) => matches(busca, p.title, p.description, p.notes))
      .map((p) =>
        item(p.title, {
          id: p.id,
          data: p.starts_on,
          pessoa: ownerLabel(p, uid, members),
          status: PURPOSE_STATUS_LABEL[p.status as PurposeStatus]?.toLowerCase() ?? null,
          detalhes: [det("Descrição", p.description), p.ends_on ? `Até: ${brDate(p.ends_on)}` : null, det("Notas", p.notes)],
        }),
      ),
    carisma: visibleToMe(rows.aulas, uid)
      .filter((l) => matches(busca, l.title, l.subject, l.teacher, l.notes, l.summary))
      .map((l) =>
        item(l.title, {
          id: l.id,
          data: l.lesson_date,
          pessoa: ownerLabel(l, uid, members),
          status: l.summary_status === "pronto" ? "com resumo" : null,
          detalhes: [det("Matéria", l.subject, 120), det("Professor", l.teacher, 120), `Arquivos: ${files.get(l.id) ?? 0}`],
        }),
      ),
  };
}

const IGREJA_TITULO: Record<string, string> = {
  palavras: "Palavras (anotações)",
  promessas: "Promessas",
  oracoes: "Orações",
  propositos: "Propósitos",
  carisma: "Aulas do Carisma",
};

export const CONSOLIDACAO_AVISO = "A Consolidação ainda não tem dados no app: a integração com o app da Consolidação vem em breve.";
export const AULA_DICA = "Para anotações, resumo e arquivos de uma aula, consulte de novo com o id dela em aula.";

export function buildIgreja(secao: string, rows: IgrejaRows, uid: string, members: People, busca?: string): ConsultaData {
  if (secao === "consolidacao") return consulta("igreja", "consolidacao", "Consolidação", [], { aviso: CONSOLIDACAO_AVISO });
  const all = igrejaItens(rows, uid, members, busca);
  if (secao === "resumo") {
    return consulta("igreja", "resumo", "Igreja", [
      grupo("Orações em andamento", all.oracoes.filter((o) => o.status === "orando"), 5),
      grupo("Propósitos em andamento", all.propositos.filter((p) => p.status !== "concluído"), 5),
      grupo("Promessas aguardando", all.promessas.filter((p) => p.status === "aguardando"), 5),
      grupo("Últimas aulas do Carisma", all.carisma, 5),
    ]);
  }
  const list = all[secao as keyof typeof all] ?? [];
  return consulta("igreja", secao, IGREJA_TITULO[secao] ?? "Igreja", [grupo(IGREJA_TITULO[secao] ?? "Itens", list)], {
    aviso: secao === "carisma" && list.length > 0 ? AULA_DICA : undefined,
  });
}

const MIME_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "Imagem",
  "image/png": "Imagem",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
};

/** Detalhe de uma aula: anotações e resumo (truncados) e arquivos prontos (referências para ler_arquivo). */
export function buildAula(l: AulaRow | null, files: AulaFileRow[], uid: string, members: People): ConsultaData {
  if (!l || (l.owner_id !== uid && !l.shared)) return consulta("igreja", "carisma", "Aula", [], { aviso: "Aula não encontrada." });
  const info = item(l.title, {
    id: l.id,
    data: l.lesson_date,
    pessoa: ownerLabel(l, uid, members),
    detalhes: [
      det("Matéria", l.subject, 120),
      det("Professor", l.teacher, 120),
      det("Anotações", l.notes, MAX_TEXTO_LONGO),
      l.summary_status === "pronto" ? det("Resumo", l.summary, MAX_TEXTO_LONGO) : null,
    ],
  });
  const arqs = files
    .filter((f) => f.lesson_id === l.id && f.status === "pronto")
    .map((f) => item(f.display_name, { detalhes: [`Tipo: ${MIME_LABEL[f.file_mime] ?? "Arquivo"}`], arquivo: arquivoRef("carisma", f.id) }));
  return consulta("igreja", "carisma", `Aula: ${txt(l.title, 120)}`, [grupo("Aula", [info]), grupo("Arquivos da aula", arqs, 20)], { aviso: null });
}

/* ---------- Busca em todo o app ---------- */

export type BuscaHit = { aba: string; titulo: unknown; data?: string | null; detalhe?: unknown; arquivo?: string | null; valor?: number | null; id?: string | null };
export const MAX_BUSCA_POR_ABA = 6;

export function buildBusca(busca: string, hits: BuscaHit[]): ConsultaData {
  const order: string[] = [];
  const byAba = new Map<string, ConsultaItem[]>();
  for (const h of hits) {
    if (!byAba.has(h.aba)) {
      byAba.set(h.aba, []);
      order.push(h.aba);
    }
    byAba.get(h.aba)!.push(item(h.titulo, { id: h.id ?? undefined, data: h.data ?? null, valor: h.valor ?? null, detalhes: [txt(h.detalhe, 160)], arquivo: h.arquivo ?? null }));
  }
  return consulta(
    "busca",
    "busca",
    `Busca: “${busca}”`,
    order.map((a) => grupo(a, byAba.get(a)!, MAX_BUSCA_POR_ABA)),
  );
}
