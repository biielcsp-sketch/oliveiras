/**
 * Dados das ferramentas do Oli e painéis da tela Início.
 * Funções puras: montam os dados a partir das linhas do banco (mesmas regras de Finanças)
 * e decidem quais painéis ficam visíveis. Nada de HTML vindo do modelo.
 */
import { summarize } from "@/lib/financas/summary";
import { billStatus, dateInMonth, invoiceFor, invoiceTotals, type BillStatus } from "@/lib/financas/planning";
import { monthLabel } from "@/lib/financas/period";
import type { Account, Bill, BillPayment, Category, Transaction } from "@/lib/financas/types";
import { matchByName, type CriarEventoArgs, type CriarLancamentoArgs, type MemoryCategory } from "./tool-args";
import { eventDays, timeLabel, untitled, type AgendaEvent } from "@/lib/agenda/view";
import { validateEventInput } from "@/lib/agenda/input";

const cents = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

/* ---------- Tipos de dados (o que volta ao modelo e alimenta o painel) ---------- */

export type ResumoData = {
  mes: string;
  mes_rotulo: string;
  entradas: number;
  saidas: number;
  saldo: number;
  categorias: { nome: string; total: number; cor: string | null }[];
};

export type SaldosData = {
  disponivel: number;
  contas: { nome: string; tipo: string; saldo: number }[];
  cartoes: { nome: string; saldo: number }[];
};

export type ContaAPagar = { nome: string; valor: number; vencimento: string; status: BillStatus; fatura: boolean };
export type ContasData = { mes: string; mes_rotulo: string; total_pendente: number; contas: ContaAPagar[] };

export type LancamentoItem = { data: string; descricao: string; valor: number; categoria: string | null; conta: string };
export type LancamentosData = { busca: string | null; itens: LancamentoItem[] };

export type LancamentoPreview = {
  descricao: string;
  valor: number; // com sinal: saída negativa
  tipo: "entrada" | "saida";
  data: string;
  categoria: { id: string; nome: string };
  conta: { id: string; nome: string };
};

export type MemoriaData = { id: string; conteudo: string; categoria: MemoryCategory | string };
export type MemoriasData = { busca: string; itens: MemoriaData[] };
export type MemoriaPreview = { conteudo: string; categoria: MemoryCategory };

export type EventoItem = {
  dia: string;
  hora: string;
  titulo: string;
  local: string | null;
  agenda: string;
  pessoa: string;
  cor: string | null;
};
export type EventosData = { de: string; ate: string; pessoa: string | null; total: number; itens: EventoItem[] };

export type EventoPreview = {
  titulo: string;
  dia_inteiro: boolean;
  /** Dia inteiro: AAAA-MM-DD (fim inclusivo); senão AAAA-MM-DDTHH:mm (São Paulo). */
  inicio: string;
  fim: string;
  local: string | null;
  agenda: { id: string; nome: string };
};

export type ConfirmStatus = "pendente" | "salvando" | "criado" | "cancelado" | "erro";

export type OliPanel =
  | { id: string; kind: "resumo"; data: ResumoData }
  | { id: string; kind: "saldos"; data: SaldosData }
  | { id: string; kind: "contas"; data: ContasData }
  | { id: string; kind: "lancamentos"; data: LancamentosData }
  | { id: string; kind: "memoria"; data: MemoriaData; titulo: string }
  | { id: string; kind: "memorias"; data: MemoriasData }
  | { id: string; kind: "confirmar_lancamento"; data: LancamentoPreview; status: ConfirmStatus; erro?: string }
  | { id: string; kind: "confirmar_esquecer"; data: MemoriaData; status: ConfirmStatus; erro?: string }
  | { id: string; kind: "confirmar_memoria"; data: MemoriaPreview; status: ConfirmStatus; erro?: string }
  | { id: string; kind: "eventos"; data: EventosData }
  | { id: string; kind: "confirmar_evento"; data: EventoPreview; status: ConfirmStatus; erro?: string }
  | { id: string; kind: "aviso"; texto: string };

/* ---------- Montagem dos dados ---------- */

export const TOP_CATEGORIES = 6;

/** Resumo do mês com as mesmas regras do Resumo de Finanças (summarize + cartões). */
export function buildResumo(month: string, txs: Transaction[], categories: Category[], accounts: Account[]): ResumoData {
  const cardIds = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const { income, expense, result, expenseByCategory } = summarize(txs, categories, cardIds);
  const catById = new Map(categories.map((c) => [c.id, c]));
  return {
    mes: month,
    mes_rotulo: monthLabel(month),
    entradas: income,
    saidas: expense,
    saldo: result,
    categorias: expenseByCategory.slice(0, TOP_CATEGORIES).map(({ category_id, total }) => {
      const cat = category_id ? catById.get(category_id) : undefined;
      return { nome: cat?.name ?? "Sem categoria", total, cor: cat?.color ?? null };
    }),
  };
}

/** Saldos: contas ativas (sem cartão) somam o disponível; cartões à parte. */
export function buildSaldos(accounts: Account[]): SaldosData {
  const active = accounts.filter((a) => !a.archived);
  const contas = active.filter((a) => a.kind !== "cartao");
  const cartoes = active.filter((a) => a.kind === "cartao");
  return {
    disponivel: reais(contas.reduce((s, a) => s + cents(a.balance), 0)),
    contas: contas.map((a) => ({ nome: a.name, tipo: a.kind, saldo: a.balance })),
    cartoes: cartoes.map((a) => ({ nome: a.name, saldo: a.balance })),
  };
}

/** Contas a pagar do mês (contas cadastradas + faturas), como na tela Contas a pagar. */
export function buildContasAPagar(input: {
  month: string;
  today: string;
  bills: Bill[];
  payments: BillPayment[];
  accounts: Account[];
  categories: Category[];
  cardTxs: Transaction[];
}): ContasData {
  const { month, today, bills, payments, accounts, categories, cardTxs } = input;
  const paymentByBill = new Map(payments.map((p) => [p.bill_id, p]));
  const transferIds = new Set(categories.filter((c) => c.kind === "transferencia").map((c) => c.id));
  const cards = accounts.filter((a) => a.kind === "cartao" && !a.archived && a.closing_day && a.due_day);

  const contas: ContaAPagar[] = [
    ...bills
      .filter((b) => b.active || paymentByBill.has(b.id))
      .map((b) => {
        const due = dateInMonth(month, b.due_day);
        const payment = paymentByBill.get(b.id);
        return {
          nome: b.name,
          valor: payment?.amount ?? b.amount,
          vencimento: due,
          status: billStatus(due, Boolean(payment), today),
          fatura: false,
        };
      }),
    ...cards.flatMap((c) => {
      const inv = invoiceFor(month, c.closing_day!, c.due_day!);
      const { total, paid } = invoiceTotals(
        cardTxs.filter((t) => t.account_id === c.id),
        transferIds,
        inv,
      );
      if (total <= 0) return [];
      return [
        {
          nome: `Fatura ${c.name}`,
          valor: total,
          vencimento: inv.due,
          status: billStatus(inv.due, paid >= total, today),
          fatura: true,
        },
      ];
    }),
  ].sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const pendente = contas.filter((c) => c.status !== "paga").reduce((s, c) => s + cents(c.valor), 0);
  return { mes: month, mes_rotulo: monthLabel(month), total_pendente: reais(pendente), contas };
}

export function buildLancamentos(
  txs: Transaction[],
  accounts: Pick<Account, "id" | "name">[],
  categories: Pick<Category, "id" | "name">[],
  busca?: string,
): LancamentosData {
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  return {
    busca: busca ?? null,
    itens: txs.map((t) => ({
      data: t.date,
      descricao: t.description,
      valor: t.amount,
      categoria: t.category_id ? (cat.get(t.category_id) ?? null) : null,
      conta: acc.get(t.account_id) ?? "",
    })),
  };
}

const MAX_OPTIONS = 15;
const options = (names: string[]) => names.slice(0, MAX_OPTIONS).join(", ");

/**
 * Resolve nomes de categoria e conta para ids da família.
 * Sem adivinhar: se não achar ou houver ambiguidade, devolve erro com as opções para o modelo perguntar.
 * Tipo vem da categoria: receita → entrada; senão, saída.
 */
export function resolveLancamento(
  args: CriarLancamentoArgs,
  accounts: Account[],
  categories: Category[],
  today: string,
): { ok: true; preview: LancamentoPreview } | { ok: false; erro: string } {
  const usable = categories.filter((c) => c.kind !== "transferencia");
  const category = matchByName(usable, args.categoria);
  if (!category) return { ok: false, erro: `Categoria não encontrada. Opções: ${options(usable.map((c) => c.name))}.` };

  const active = accounts.filter((a) => !a.archived);
  let account: Account | null = null;
  if (args.conta) {
    account = matchByName(active, args.conta);
    if (!account) return { ok: false, erro: `Conta não encontrada. Opções: ${options(active.map((a) => a.name))}.` };
  } else if (active.length === 1) {
    account = active[0];
  } else {
    const correntes = active.filter((a) => a.kind === "corrente");
    if (correntes.length === 1) account = correntes[0];
  }
  if (!account) {
    return active.length === 0
      ? { ok: false, erro: "Nenhuma conta cadastrada em Finanças." }
      : { ok: false, erro: `Pergunte em qual conta lançar. Opções: ${options(active.map((a) => a.name))}.` };
  }

  const tipo = category.kind === "receita" ? "entrada" : "saida";
  return {
    ok: true,
    preview: {
      descricao: args.descricao,
      valor: tipo === "entrada" ? args.valor : -args.valor,
      tipo,
      data: args.data ?? today,
      categoria: { id: category.id, nome: category.name },
      conta: { id: account.id, nome: account.name },
    },
  };
}

/* ---------- Agenda ---------- */

export const MAX_EVENT_ITEMS = 40;

/** Eventos do período, cada um uma vez, no primeiro dia dele dentro do período. */
export function buildEventos(events: AgendaEvent[], de: string, ate: string, pessoa?: string | null): EventosData {
  const itens = events
    .map((e) => {
      const dia = eventDays(e).find((d) => d >= de && d <= ate);
      return dia ? { e, dia } : null;
    })
    .filter((x) => x !== null)
    .sort((a, b) => a.dia.localeCompare(b.dia) || Number(b.e.allDay) - Number(a.e.allDay) || a.e.startsAt.localeCompare(b.e.startsAt))
    .map(({ e, dia }) => ({
      dia,
      hora: timeLabel(e, dia),
      titulo: untitled(e.title),
      local: e.location,
      agenda: e.calendarName,
      pessoa: e.owner,
      cor: e.color,
    }));
  return { de, ate, pessoa: pessoa ?? null, total: itens.length, itens: itens.slice(0, MAX_EVENT_ITEMS) };
}

export type WritableCalendar = { id: string; summary: string; primary: boolean };

/**
 * Resolve a agenda pelo nome ou usa a principal do usuário. Sem adivinhar: ambíguo ou ausente → erro com opções.
 * Valida o evento com as mesmas regras do formulário.
 */
export function resolveEvento(
  args: CriarEventoArgs,
  calendars: WritableCalendar[],
): { ok: true; preview: EventoPreview } | { ok: false; erro: string } {
  if (calendars.length === 0) return { ok: false, erro: "Nenhuma agenda sua conectada. Conecte o Google na tela Agenda." };
  const named = calendars.map((c) => ({ ...c, name: c.summary }));
  let cal: WritableCalendar | null = null;
  if (args.agenda) {
    cal = matchByName(named, args.agenda);
    if (!cal) return { ok: false, erro: `Agenda não encontrada ou ambígua. Opções: ${options(named.map((c) => c.name))}.` };
  } else {
    const primaries = calendars.filter((c) => c.primary);
    cal = primaries.length === 1 ? primaries[0] : calendars.length === 1 ? calendars[0] : null;
    if (!cal) return { ok: false, erro: `Pergunte em qual agenda criar. Opções: ${options(named.map((c) => c.name))}.` };
  }
  const v = validateEventInput({ title: args.titulo, allDay: args.dia_inteiro, start: args.inicio, end: args.fim, location: args.local });
  if (!v.ok) return { ok: false, erro: v.erro };
  return {
    ok: true,
    preview: {
      titulo: v.value.title,
      dia_inteiro: v.value.allDay,
      inicio: v.value.start,
      fim: v.value.end,
      local: v.value.location,
      agenda: { id: cal.id, nome: cal.summary },
    },
  };
}

/* ---------- Memórias ---------- */

/** Teto de memórias por família (o prompt usa só as 30 mais recentes; isto limita abuso e injeção em massa). */
export const MAX_MEMORIES_PER_HOUSEHOLD = 200;

export function memoryLimitError(count: number) {
  return count >= MAX_MEMORIES_PER_HOUSEHOLD
    ? `Limite de ${MAX_MEMORIES_PER_HOUSEHOLD} memórias atingido. Peça para esquecer alguma antes de guardar outra.`
    : null;
}

/* ---------- Painéis visíveis ---------- */

export const MAX_PANELS = 4;

const isPending = (p: OliPanel) =>
  (p.kind === "confirmar_lancamento" ||
    p.kind === "confirmar_esquecer" ||
    p.kind === "confirmar_memoria" ||
    p.kind === "confirmar_evento") &&
  (p.status === "pendente" || p.status === "salvando");

/** Novo painel no topo; no máximo MAX_PANELS. Confirmações pendentes nunca somem. */
export function pushPanel(list: OliPanel[], panel: OliPanel, max = MAX_PANELS): OliPanel[] {
  const next = [panel, ...list];
  while (next.length > max) {
    let idx = -1;
    for (let i = next.length - 1; i >= 0; i--) {
      if (!isPending(next[i])) {
        idx = i;
        break;
      }
    }
    if (idx < 0) break;
    next.splice(idx, 1);
  }
  return next;
}

/** Limpa os painéis, mantendo confirmações que ainda esperam o toque. */
export function clearPanels(list: OliPanel[]) {
  return list.filter(isPending);
}
