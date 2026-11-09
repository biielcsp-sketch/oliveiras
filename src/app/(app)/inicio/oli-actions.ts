"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { getFinanceBase, getTransactions } from "@/lib/financas/data";
import { getBillPayments, getBills, getTransactionsAround } from "@/lib/financas/planning-data";
import { currentMonth } from "@/lib/financas/period";
import { todaySP } from "@/lib/financas/today";
import { validateManualTransaction, UUID_RE } from "@/lib/financas/transaction-input";
import { validateEventInput } from "@/lib/agenda/input";
import { toSpDate } from "@/lib/agenda/dates";
import { oliAllowedFor } from "@/lib/oli/access";
import { getEventsBetween, loadAccounts, writableCalendarsOf, agendaEnabled, createEvent, removeEvent } from "@/lib/google/agenda";
import {
  isToolName,
  parseAgendaPeriodoArgs,
  parseCriarEventoArgs,
  parseExcluirEventoArgs,
  parseConsultarMemoriaArgs,
  parseCriarLancamentoArgs,
  parseEsquecerMemoriaArgs,
  parseResumoArgs,
  parseSalvarMemoriaArgs,
  parseUltimosArgs,
  matchByName,
  type OliToolName,
} from "@/lib/oli/tool-args";
import {
  buildEventos,
  buildContasAPagar,
  buildLancamentos,
  buildResumo,
  buildSaldos,
  resolveLancamento,
  type ContasData,
  type EventoPreview,
  type EventosData,
  resolveEvento,
  resolveExclusao,
  exclusaoNegada,
  type EventoCandidato,
  type ExcluirEventoPreview,
  type LancamentoPreview,
  type LancamentosData,
  memoryLimitError,
  type MemoriaData,
  type MemoriaPreview,
  type MemoriasData,
  type ResumoData,
  type SaldosData,
} from "@/lib/oli/panels";

/**
 * Ferramentas do Oli. Rodam com a sessão do usuário (RLS), nunca com chave de serviço.
 * Escritas sensíveis (lançamento, apagar memória) só preparam aqui; gravam nas ações de confirmação.
 */
export type OliToolResult =
  | { ok: true; tool: "resumo_do_mes"; data: ResumoData }
  | { ok: true; tool: "saldo_das_contas"; data: SaldosData }
  | { ok: true; tool: "contas_a_pagar"; data: ContasData }
  | { ok: true; tool: "ultimos_lancamentos"; data: LancamentosData }
  | { ok: true; tool: "criar_lancamento"; data: LancamentoPreview }
  | { ok: true; tool: "salvar_memoria"; data: MemoriaPreview }
  | { ok: true; tool: "consultar_memoria"; data: MemoriasData }
  | { ok: true; tool: "esquecer_memoria"; data: MemoriaData }
  | { ok: true; tool: "agenda_periodo"; data: EventosData }
  | { ok: true; tool: "criar_evento"; data: EventoPreview }
  | { ok: true; tool: "excluir_evento"; data: ExcluirEventoPreview }
  | { ok: false; erro: string; candidatos?: EventoCandidato[] };

const err = (erro: string): OliToolResult => ({ ok: false, erro });

export async function runOliTool(name: string, args: unknown): Promise<OliToolResult> {
  if (!isToolName(name)) return err("Ferramenta desconhecida.");
  try {
    return await dispatch(name, args);
  } catch (e) {
    console.error("Oli: ferramenta falhou:", name, e instanceof Error ? e.message : "erro");
    return err("Não consegui consultar agora.");
  }
}

async function dispatch(name: OliToolName, args: unknown): Promise<OliToolResult> {
  switch (name) {
    case "resumo_do_mes": {
      const a = parseResumoArgs(args);
      if (!a.ok) return err(a.erro);
      const month = a.value.mes ?? currentMonth();
      const [{ accounts, categories }, txs] = await Promise.all([getFinanceBase(), getTransactions({ month })]);
      return { ok: true, tool: name, data: buildResumo(month, txs, categories, accounts) };
    }
    case "saldo_das_contas": {
      const { accounts } = await getFinanceBase();
      return { ok: true, tool: name, data: buildSaldos(accounts) };
    }
    case "contas_a_pagar": {
      const month = currentMonth();
      const { accounts, categories } = await getFinanceBase();
      const cards = accounts.filter((a) => a.kind === "cartao" && !a.archived && a.closing_day && a.due_day);
      const [bills, payments, cardTxs] = await Promise.all([
        getBills(),
        getBillPayments(month),
        getTransactionsAround(month, cards.map((c) => c.id)),
      ]);
      return {
        ok: true,
        tool: name,
        data: buildContasAPagar({ month, today: todaySP(), bills, payments, accounts, categories, cardTxs }),
      };
    }
    case "ultimos_lancamentos": {
      const a = parseUltimosArgs(args);
      if (!a.ok) return err(a.erro);
      const { household } = await getAppContext();
      const supabase = await createClient();
      let q = supabase
        .from("fin_transactions")
        .select("id, account_id, date, description, amount, category_id, member_id, notes, source")
        .eq("household_id", household.id)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(a.value.limite);
      if (a.value.busca) q = q.ilike("description", `%${a.value.busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const [{ data }, { accounts, categories }] = await Promise.all([q, getFinanceBase()]);
      const txs = (data ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
      return { ok: true, tool: name, data: buildLancamentos(txs, accounts, categories, a.value.busca) };
    }
    case "criar_lancamento": {
      const a = parseCriarLancamentoArgs(args);
      if (!a.ok) return err(a.erro);
      const { accounts, categories } = await getFinanceBase();
      const r = resolveLancamento(a.value, accounts, categories, todaySP());
      if (!r.ok) return err(r.erro);
      return { ok: true, tool: name, data: r.preview };
    }
    case "salvar_memoria": {
      // Só prepara: grava em confirmOliMemoria, depois do toque do usuário.
      const a = parseSalvarMemoriaArgs(args);
      if (!a.ok) return err(a.erro);
      const limit = memoryLimitError(await countMemories());
      if (limit) return err(limit);
      return { ok: true, tool: name, data: a.value };
    }
    case "consultar_memoria": {
      const a = parseConsultarMemoriaArgs(args);
      if (!a.ok) return err(a.erro);
      const { household } = await getAppContext();
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("oli_search_memories", {
        p_household: household.id,
        p_query: a.value.busca,
        p_limit: 8,
      });
      if (error) return err("Não consegui procurar nas memórias.");
      const rows = (data ?? []) as { id: string; category: string; content: string }[];
      return {
        ok: true,
        tool: name,
        data: { busca: a.value.busca, itens: rows.map((m) => ({ id: m.id, categoria: m.category, conteudo: m.content })) },
      };
    }
    case "esquecer_memoria": {
      const a = parseEsquecerMemoriaArgs(args);
      if (!a.ok) return err(a.erro);
      const memory = await findMemory(a.value.id);
      if (!memory) return err("Memória não encontrada.");
      return { ok: true, tool: name, data: memory };
    }
    case "agenda_periodo": {
      const a = parseAgendaPeriodoArgs(args, todaySP());
      if (!a.ok) return err(a.erro);
      const ctx = await getAppContext();
      if (!agendaEnabled(ctx.household.id)) return err("A Agenda não está liberada para esta família.");
      let memberId: string | null = null;
      let pessoa: string | null = null;
      if (a.value.pessoa) {
        const people = ctx.members.filter((m) => m.user_id);
        const q = a.value.pessoa;
        const found = /^(eu|mim|minha|meu)$/i.test(q.trim()) ? ctx.me : matchByName(people, q);
        if (!found) return err(`Pessoa não encontrada. Opções: ${people.map((m) => m.name).join(", ")}.`);
        memberId = found.id;
        pessoa = found.name;
      }
      const events = (await getEventsBetween(ctx, a.value.de, a.value.ate)).filter((e) => !memberId || e.memberId === memberId);
      return { ok: true, tool: name, data: buildEventos(events, a.value.de, a.value.ate, pessoa) };
    }
    case "criar_evento": {
      // Só prepara: grava em confirmOliEvento, depois do toque do usuário.
      const a = parseCriarEventoArgs(args);
      if (!a.ok) return err(a.erro);
      const { household } = await getAppContext();
      if (!agendaEnabled(household.id)) return err("A Agenda não está liberada para esta família.");
      const r = resolveEvento(a.value, await writableCalendars());
      if (!r.ok) return err(r.erro);
      return { ok: true, tool: name, data: r.preview };
    }
    case "excluir_evento": {
      // Só prepara: apaga em confirmOliExcluirEvento, depois do toque do usuário.
      const a = parseExcluirEventoArgs(args);
      if (!a.ok) return err(a.erro);
      const ctx = await getAppContext();
      if (!oliAllowedFor(ctx.household.id)) return err("O Oli não está liberado para esta família.");
      if (!agendaEnabled(ctx.household.id)) return err("A Agenda não está liberada para esta família.");
      const events = a.value.id ? await eventsOfId(ctx, a.value.id) : await getEventsBetween(ctx, a.value.data!, a.value.data!);
      const r = resolveExclusao(a.value, events);
      if (!r.ok) return r;
      return { ok: true, tool: name, data: r.preview };
    }
  }
}

/** Evento pelo id (da família, via RLS): carrega o dia dele para reaproveitar a montagem da Agenda. */
async function eventsOfId(ctx: Awaited<ReturnType<typeof getAppContext>>, id: string) {
  const db = await createClient();
  const { data } = await db.from("cal_events").select("starts_at").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!data) return [];
  const day = toSpDate(data.starts_at);
  return getEventsBetween(ctx, day, day);
}

async function writableCalendars() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { accounts, calendars } = await loadAccounts(db, ctx.household.id);
  return writableCalendarsOf(ctx, accounts, calendars).map((c) => ({ id: c.id, summary: c.summary, primary: c.primary }));
}

async function countMemories() {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("oli_memories")
    .select("id", { count: "exact", head: true })
    .eq("household_id", household.id);
  if (error) throw new Error("contagem de memórias falhou");
  return count ?? 0;
}

async function findMemory(id: string): Promise<MemoriaData | null> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("oli_memories")
    .select("id, category, content")
    .eq("household_id", household.id)
    .eq("id", id)
    .maybeSingle();
  return data ? { id: data.id, categoria: data.category, conteudo: data.content } : null;
}

export type ConfirmResult = { ok: true } | { ok: false; erro: string };

/** Grava o lançamento depois do toque em Confirmar. Revalida tudo: o cliente não é confiável. */
export async function confirmOliLancamento(preview: LancamentoPreview): Promise<ConfirmResult> {
  const { household, me } = await getAppContext();
  if (!preview || typeof preview !== "object") return { ok: false, erro: "Dados inválidos." };
  const { accounts, categories } = await getFinanceBase();
  const account = accounts.find((a) => a.id === preview.conta?.id && !a.archived);
  const category = categories.find((c) => c.id === preview.categoria?.id && c.kind !== "transferencia");
  if (!account || !category) return { ok: false, erro: "Conta ou categoria não encontrada." };

  const parsed = validateManualTransaction({
    accountId: account.id,
    description: String(preview.descricao ?? ""),
    value: typeof preview.valor === "number" ? preview.valor : null,
    date: String(preview.data ?? ""),
    // Mesma regra do preparo: categoria de receita entra; as demais saem.
    direction: category.kind === "receita" ? "entrada" : "saida",
    categoryId: category.id,
    memberId: me?.id ?? null,
  });
  if ("error" in parsed) return { ok: false, erro: parsed.error ?? "Dados inválidos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("fin_transactions")
    .insert({ ...parsed.data, household_id: household.id, source: "manual" });
  if (error) return { ok: false, erro: "Não foi possível salvar. Confira conta e categoria." };

  revalidatePath("/financas", "layout");
  return { ok: true };
}

/** Guarda a memória depois do toque em Confirmar. Revalida tamanho, categoria e o teto da família. */
export async function confirmOliMemoria(preview: MemoriaPreview): Promise<ConfirmResult> {
  const { household, me } = await getAppContext();
  const a = parseSalvarMemoriaArgs(preview);
  if (!a.ok) return { ok: false, erro: a.erro };
  const limit = memoryLimitError(await countMemories());
  if (limit) return { ok: false, erro: limit };
  const supabase = await createClient();
  const { error } = await supabase.from("oli_memories").insert({
    household_id: household.id,
    member_id: me?.id ?? null,
    category: a.value.categoria,
    content: a.value.conteudo,
    source: "oli",
  });
  if (error) return { ok: false, erro: "Não consegui guardar a memória." };
  return { ok: true };
}

/** Apaga a memória depois do toque em Confirmar. */
export async function confirmOliEsquecer(id: string): Promise<ConfirmResult> {
  const { household } = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Id inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("oli_memories")
    .delete()
    .eq("household_id", household.id)
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { ok: false, erro: "Memória não encontrada." };
  return { ok: true };
}

/** Cria o evento no Google depois do toque em Confirmar. Revalida agenda e dados: o cliente não é confiável. */
export async function confirmOliEvento(preview: EventoPreview): Promise<ConfirmResult> {
  const ctx = await getAppContext();
  if (!preview || typeof preview !== "object") return { ok: false, erro: "Dados inválidos." };
  const cal = (await writableCalendars()).find((c) => c.id === preview.agenda?.id);
  if (!cal) return { ok: false, erro: "Agenda não encontrada." };
  const v = validateEventInput({
    title: preview.titulo,
    allDay: preview.dia_inteiro === true,
    start: preview.inicio,
    end: preview.fim,
    location: preview.local,
  });
  if (!v.ok) return { ok: false, erro: v.erro };
  const r = await createEvent(ctx, cal.id, v.value);
  if (!r.ok) return { ok: false, erro: r.erro };
  revalidatePath("/agenda");
  return { ok: true };
}

/**
 * Apaga o evento no Google depois do toque em Confirmar. O cliente só manda o id: tudo é revalidado aqui
 * (família do Oli, Agenda liberada, evento da família, agenda gravável; qualquer membro da família apaga, com o token da conta dona). removeEvent usa If-Match/etag:
 * 412 recarrega e avisa o conflito; 404/410 contam como já apagado. Só a ocorrência exibida.
 */
export async function confirmOliExcluirEvento(id: string): Promise<ConfirmResult> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Evento inválido." };
  if (!oliAllowedFor(ctx.household.id)) return { ok: false, erro: "O Oli não está liberado para esta família." };
  if (!agendaEnabled(ctx.household.id)) return { ok: false, erro: "A Agenda não está liberada para esta família." };
  const event = (await eventsOfId(ctx, id)).find((e) => e.id === id);
  if (!event) return { ok: false, erro: "Evento não encontrado. Ele pode já ter sido apagado." };
  const negado = exclusaoNegada(event);
  if (negado) return { ok: false, erro: negado };
  const r = await removeEvent(ctx, id);
  revalidatePath("/agenda"); // também no 412/conflito: a cópia local foi recarregada
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true };
}
