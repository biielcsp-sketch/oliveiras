import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createClient } from "@/lib/supabase/server";
import type { getAppContext } from "@/lib/data";
import { getFinanceBase } from "@/lib/financas/data";
import { transactionUses } from "@/lib/financas/baixa-data";
import { todaySP } from "@/lib/financas/today";
import { brDate } from "@/lib/agenda/dates";
import { agendaEnabled, loadAccounts, writableCalendarsOf } from "@/lib/google/agenda";
import { MEAL_LABEL, type Meal } from "@/lib/casa/types";
import { completeChore, deleteChore, deleteMaintenance, deleteShoppingItem, markMaintenanceDone, saveChore, saveMaintenance, saveShoppingItem, toggleShoppingItem } from "@/app/(app)/casa/actions";
import { deleteCasaDocument, saveCasaDocument } from "@/app/(app)/casa/documentos-actions";
import { deleteMeal, saveMeal } from "@/app/(app)/casa/cardapio-actions";
import { deleteProvider, saveProvider } from "@/app/(app)/casa/prestadores-actions";
import {
  deletePetCare,
  deletePetFood,
  deletePetHealth,
  deletePetVet,
  deletePetWeight,
  markPetCareDone,
  savePetCare,
  savePetFood,
  savePetHealth,
  savePetVet,
  savePetWeight,
} from "@/app/(app)/casa/pet-actions";
import { deletePrayer, deletePurpose, deleteWord, savePrayer, savePurpose, saveWord } from "@/app/(app)/ministerio/devocional-actions";
import { deleteLesson, saveLesson } from "@/app/(app)/ministerio/carisma-actions";
import {
  deleteAppointment,
  deleteCard,
  deleteExam,
  deleteMedication,
  deleteProcedure,
  deleteVaccine,
  saveAppointment,
  saveCard,
  saveExam,
  saveMedication,
  saveProcedure,
  saveVaccine,
  setAppointmentStatus,
  setMedicationActive,
} from "@/app/(app)/saude/actions";
import { deleteAgendaEvent, saveEvent } from "@/app/(app)/agenda/actions";
import { deleteTransaction, saveTransaction } from "@/app/(app)/financas/actions";
import { deleteBill, deleteGoal, payBill, saveBill, saveBudget, saveGoal, undoPayment } from "@/app/(app)/financas/planning-actions";
import { deleteOneOff, payOneOff, saveOneOff, undoOneOffPayment } from "@/app/(app)/financas/avulsas-actions";
import {
  consultaAgendaAviso,
  contaFixaApagarAviso,
  driveAviso,
  eventoApagarAviso,
  lancamentoApagarAviso,
  matchOpcao,
  planAlteracao,
  planToFormEntries,
  specFor,
  type AlteracaoPlan,
  type AlterarArgs,
  type AlterarLookup,
  type Row,
} from "./alterar";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { matchByName } from "./tool-args";

/**
 * Lado do servidor da escrita do Oli (Casa, Pet, Igreja): lê a linha atual com a sessão do usuário (RLS) e, no
 * Confirmar, grava pelas MESMAS server actions das telas (mesma validação, regras de dono da Igreja e remoção de
 * arquivo do storage). Nunca usa chave de serviço.
 */
type Ctx = Awaited<ReturnType<typeof getAppContext>>;
type Db = Awaited<ReturnType<typeof createClient>>;

export type Prepared = { ok: true; plan: AlteracaoPlan; row: Row | null } | { ok: false; erro: string };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const AVISO_FALHOU_LEITURA = "Não consegui conferir o item agora. Nada foi alterado: tente de novo.";
type LookupResult = { ok: true; lk: AlterarLookup } | { ok: false; erro: string };

/**
 * Dados de apoio do plano, lidos com a sessão do usuário (RLS). Qualquer consulta que decide uma regra
 * (dono do evento, pagamento atual, lançamento escolhido) que falhe RECUSA: nunca segue sem a conferência.
 */
async function lookup(ctx: Ctx, db: Db, a: AlterarArgs, row: Row | null): Promise<LookupResult> {
  const hh = ctx.household.id;
  const lk: AlterarLookup = {
    uid: ctx.user.id,
    me: ctx.me ? { id: ctx.me.id, name: ctx.me.name } : null,
    members: ctx.members.map((m) => ({ id: m.id, name: m.name, user_id: m.user_id })),
    pets: [],
    today: todaySP(),
  };
  if (a.aba === "pet") {
    const { data } = await db.from("casa_pets").select("id, name").eq("household_id", hh).order("name").limit(50);
    lk.pets = (data ?? []) as { id: string; name: string }[];
  }
  if (a.aba === "agenda") {
    if (!agendaEnabled(hh)) return { ok: false, erro: "A Agenda não está liberada para esta família." };
    const { accounts, calendars } = await loadAccounts(db, hh);
    const writable = writableCalendarsOf(ctx, accounts, calendars);
    lk.calendars = writable.map((c) => ({ id: c.id, summary: c.summary, primary: c.primary }));
    if (row) {
      const cal = calendars.find((c) => c.id === row.calendar_ref);
      const acc = accounts.find((x) => x.id === cal?.account_ref);
      const dono = ctx.members.find((m) => m.id === acc?.member_id)?.name ?? "outra pessoa da família";
      lk.extra = { evento: { editavel: writable.some((c) => c.id === row.calendar_ref), dono } };
    }
  }
  if (a.aba === "financas") {
    const { accounts, categories } = await getFinanceBase();
    const ativas = accounts.filter((x) => !x.archived);
    // Lançamento em conta arquivada: a conta dele continua valendo na edição.
    const propria = row && typeof row.account_id === "string" ? accounts.find((x) => x.id === row.account_id && x.archived) : undefined;
    lk.accounts = [...ativas, ...(propria ? [propria] : [])].map((x) => ({ id: x.id, name: x.name }));
    lk.categories = categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
    if (a.acao === "concluir" && row && (a.secao === "contas_fixas" || a.secao === "contas_avulsas")) {
      const r = await pagamentoExtra(db, hh, a, row, lk.today);
      if (!r.ok) return r;
      if (r.pag) lk.extra = { pag: r.pag };
    }
  }
  return { ok: true, lk };
}

/** Estado atual do pagamento (conta fixa: do mês) e o lançamento escolhido, com onde ele já está ligado. */
async function pagamentoExtra(db: Db, hh: string, a: AlterarArgs, row: Row, today: string) {
  const falhou = { ok: false as const, erro: AVISO_FALHOU_LEITURA };
  const fixa = a.secao === "contas_fixas";
  let mes: string | null = null;
  if (fixa) {
    mes = (typeof a.valores.mes === "string" ? a.valores.mes.trim() : "") || today.slice(0, 7);
    if (!MONTH_RE.test(mes)) return { ok: true as const, pag: null }; // o plano recusa: mês inválido
  }
  let pg: { id: string; auto: boolean; paid_on: string; amount: number } | null = null;
  if (fixa) {
    const { data, error } = await db.from("fin_bill_payments").select("id, auto, paid_on, amount").eq("household_id", hh).eq("bill_id", String(row.id)).eq("month", mes!).maybeSingle();
    if (error) return falhou;
    if (data) pg = { id: data.id, auto: data.auto === true, paid_on: data.paid_on, amount: Number(data.amount) };
  }
  let tx: { id: string; date: string; amount: number; description: string } | null = null;
  let usos = { fixed: [] as { bill_id: string; month: string }[], oneOff: [] as { id: string }[] };
  const txId = typeof a.valores.lancamento === "string" ? a.valores.lancamento.trim().toLowerCase() : "";
  if (txId && UUID_RE.test(txId)) {
    const { data, error } = await db.from("fin_transactions").select("id, date, amount, description").eq("household_id", hh).eq("id", txId).maybeSingle();
    if (error) return falhou;
    if (data) {
      tx = { id: data.id, date: data.date, amount: Number(data.amount), description: data.description };
      usos = await transactionUses(db, hh, tx.id);
    }
  }
  return { ok: true as const, pag: { mes, pagamento: pg, tx, usos } };
}

/** Orçamento não tem id: acha a linha pela categoria (de despesa), escopo e mês. */
async function acharOrcamento(ctx: Ctx, db: Db, a: AlterarArgs): Promise<{ ok: true; row: Row | null } | { ok: false; erro: string }> {
  const { categories } = await getFinanceBase();
  const despesas = categories.filter((c) => c.kind === "despesa");
  const cat = typeof a.valores.categoria === "string" ? matchByName(despesas, a.valores.categoria) : null;
  if (!cat) return { ok: false, erro: `Categoria de despesa não encontrada ou ambígua. Opções: ${despesas.map((c) => c.name).join(", ") || "nenhuma"}.` };
  const escopoArg = typeof a.valores.escopo === "string" ? matchOpcao(a.valores.escopo, { todos: "Todos os meses", mes: "Só um mês" }) : "todos";
  if (!escopoArg) return { ok: false, erro: "Escopo inválido. Use: todos ou mes." };
  let mes: string | null = null;
  if (escopoArg === "mes") {
    mes = (typeof a.valores.mes === "string" ? a.valores.mes.trim() : "") || todaySP().slice(0, 7);
    if (!MONTH_RE.test(mes)) return { ok: false, erro: "Mês inválido. Use AAAA-MM." };
  }
  const spec = specFor(a.aba, a.secao)!;
  let q = db.from(spec.table).select(spec.cols).eq("household_id", ctx.household.id).eq("category_id", cat.id);
  q = mes ? q.eq("month", mes) : q.is("month", null);
  const { data, error } = await q.maybeSingle();
  if (error) return { ok: false, erro: "Não consegui ler o orçamento agora." };
  return { ok: true, row: (data as Row | null) ?? null };
}

const ARQUIVO_AVISO = "O arquivo guardado também será apagado.";

const AVISO_FALHOU = "Não consegui conferir o item agora. Nada foi alterado: tente de novo.";

/**
 * Avisos que dependem do banco (arquivo junto, item que será substituído). Entram no painel e no conferir do Confirmar.
 * Se a consulta que decide o aviso falhar, recusa (nunca mostra um painel sem o aviso que deveria ter).
 */
async function avisoDe(ctx: Ctx, db: Db, plan: AlteracaoPlan, row: Row | null, lk: AlterarLookup): Promise<{ ok: true; aviso: string | null } | { ok: false; erro: string }> {
  const { preview: p, raw } = plan;
  const hh = ctx.household.id;
  const key = `${p.aba}/${p.secao}`;
  const aviso = (a: string | null) => ({ ok: true as const, aviso: a });
  const falhou = { ok: false as const, erro: AVISO_FALHOU };
  if (key === "saude/consultas" && p.acao !== "criar") {
    return aviso(
      consultaAgendaAviso({
        acao: p.acao,
        temEvento: Boolean(row?.agenda_event_id),
        agendaLigada: agendaEnabled(hh),
        statusAntes: String(row?.status ?? ""),
        statusDepois: String(raw.status ?? row?.status ?? ""),
      }),
    );
  }
  if (p.acao === "apagar") {
    if (p.aba === "saude" && key !== "saude/consultas" && key !== "saude/medicamentos" && row?.file_path) return aviso(ARQUIVO_AVISO);
    if (key === "agenda/eventos") {
      const { count, error } = await db.from("health_appointments").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("agenda_event_id", p.id!);
      if (error || typeof count !== "number") return falhou;
      const agenda = lk.calendars?.find((c) => c.id === row?.calendar_ref)?.summary ?? null;
      return aviso(eventoApagarAviso(agenda, count));
    }
    if (key === "financas/contas_fixas") {
      const { count, error } = await db.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("bill_id", p.id!);
      if (error || typeof count !== "number") return falhou;
      return aviso(contaFixaApagarAviso(count));
    }
    if (key === "financas/lancamentos") {
      // Alerta sempre: o efeito no saldo e nos relatórios existe mesmo sem conta ligada. A contagem de baixas vem do banco.
      const [fixas, avulsas] = await Promise.all([
        db.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("transaction_id", p.id!),
        db.from("fin_one_off_bills").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("transaction_id", p.id!),
      ]);
      if (fixas.error || avulsas.error || typeof fixas.count !== "number" || typeof avulsas.count !== "number") return falhou;
      const conta = lk.accounts?.find((x) => x.id === row?.account_id)?.name ?? "a conta";
      return aviso(lancamentoApagarAviso({ valor: Number(row?.amount), conta, data: String(row?.date ?? "") }, { fixas: fixas.count, avulsas: avulsas.count }));
    }
    if ((p.secao === "documentos" || p.secao === "saude" || p.secao === "veterinario") && row?.file_path) return aviso(ARQUIVO_AVISO);
    if (p.secao === "prestadores") return aviso("Manutenções ligadas a este prestador ficam sem prestador.");
    if (p.secao === "carisma") {
      const { count, error } = await db.from("igreja_carisma_files").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("lesson_id", p.id!);
      if (error || typeof count !== "number") return falhou;
      return aviso(driveAviso(Boolean(row?.drive_folder_id), count));
    }
    return aviso(null);
  }
  if (p.acao === "criar" && p.secao === "cardapio") {
    const { data, error } = await db.from("casa_meal_plan").select("title").eq("household_id", hh).eq("day", String(raw.day)).eq("meal", String(raw.meal)).maybeSingle();
    if (error) return falhou;
    if (data) return aviso(`Já tem “${String(data.title).slice(0, 120)}” no ${MEAL_LABEL[raw.meal as Meal]?.toLowerCase() ?? "horário"} de ${brDate(String(raw.day))}: vai ser substituído.`);
  }
  if (p.acao === "criar" && p.secao === "peso") {
    const { data, error } = await db.from("casa_pet_weights").select("weight_kg").eq("household_id", hh).eq("pet_id", String(raw.pet_id)).eq("measured_on", String(raw.measured_on)).maybeSingle();
    if (error) return falhou;
    if (data) return aviso(`Já tem pesagem nesse dia (${String(Number(data.weight_kg)).replace(".", ",")} kg): vai ser substituída.`);
  }
  return aviso(null);
}

/** Prepara (sem gravar): linha atual + plano + painel. */
export async function prepararAlteracao(ctx: Ctx, a: AlterarArgs): Promise<Prepared> {
  const spec = specFor(a.aba, a.secao);
  if (!spec) return { ok: false, erro: "Seção inválida." };
  const db = await createClient();
  let row: Row | null = null;
  if (spec.semId) {
    const f = await acharOrcamento(ctx, db, a);
    if (!f.ok) return f;
    row = f.row;
  } else if (a.id) {
    const { data, error } = await db.from(spec.table).select(spec.cols).eq("household_id", ctx.household.id).eq("id", a.id).maybeSingle();
    if (error) return { ok: false, erro: "Não consegui ler o item agora." };
    row = (data as Row | null) ?? null;
  }
  const l = await lookup(ctx, db, a, row);
  if (!l.ok) return l;
  const r = planAlteracao(a, row, l.lk);
  if (!r.ok) return r;
  const av = await avisoDe(ctx, db, r.plan, row, l.lk);
  if (!av.ok) return av;
  // O plano pode trazer o próprio aviso (desfazer pagamento); o do banco entra junto.
  r.plan.preview.aviso = [r.plan.preview.aviso, av.aviso].filter(Boolean).join(" ") || null;
  return { ok: true, plan: r.plan, row };
}

type SaveFn = (prev: null, form: FormData) => Promise<{ ok?: boolean; error?: string; message?: string } | null | void>;
type DeleteFn = (id: string) => Promise<{ ok: boolean; erro?: string; aviso?: string }>;

const SAVE: Record<string, SaveFn> = {
  "casa/tarefas": saveChore,
  "casa/compras": saveShoppingItem,
  "casa/manutencao": saveMaintenance,
  "casa/documentos": saveCasaDocument,
  "casa/cardapio": saveMeal,
  "casa/prestadores": saveProvider,
  "pet/saude": savePetHealth,
  "pet/veterinario": savePetVet,
  "pet/cuidados": savePetCare,
  "pet/peso": savePetWeight,
  "pet/racao": savePetFood,
  "igreja/palavras": saveWord,
  "igreja/promessas": saveWord,
  "igreja/oracoes": savePrayer,
  "igreja/propositos": savePurpose,
  "igreja/carisma": saveLesson,
  // Saúde: carteirinha/exame/vacina/procedimento sem o campo "file" mantêm o arquivo que já existe.
  "saude/consultas": saveAppointment, // sincroniza com a Agenda/Google, como a tela
  "saude/exames": saveExam,
  "saude/vacinas": saveVaccine,
  "saude/procedimentos": saveProcedure,
  "saude/medicamentos": saveMedication,
  "saude/carteirinhas": saveCard,
  "agenda/eventos": saveEvent, // grava no Google Calendar, como a tela
  // Finanças: estas actions terminam em redirect() quando dão certo (ver rodar).
  "financas/contas_fixas": saveBill,
  "financas/contas_avulsas": saveOneOff,
  "financas/metas": saveGoal,
  "financas/orcamento": saveBudget,
  "financas/lancamentos": saveTransaction,
};

/**
 * Roda uma action das telas. Várias actions de Finanças terminam em redirect(), que no Next é uma exceção
 * (NEXT_REDIRECT) e só acontece depois do sucesso: aqui ela vale como "salvou" e NÃO sai da função (senão
 * a tela navegaria e o painel nunca receberia a resposta). Qualquer outra exceção segue para o chamador.
 */
/**
 * Só vale como sucesso o redirect para uma tela de Finanças (destino das actions depois de gravar). getAppContext/getUser
 * também chamam redirect("/login") e redirect("/bem-vindo") ANTES de gravar (sessão expirada, família que sumiu):
 * esses e qualquer outro destino viram erro, nunca "salvo".
 */
function redirectOk(e: unknown): boolean {
  if (!isRedirectError(e)) return false;
  const dest = String((e as { digest?: unknown }).digest ?? "").split(";")[2] ?? "";
  return /^\/financas(\/|\?|$)/.test(dest);
}
const REDIRECT_RECUSADO = "Não consegui gravar: a sessão expirou ou a família mudou. Entre de novo e peça outra vez. Nada foi alterado.";

async function rodar(run: () => Promise<{ ok?: boolean; error?: string } | null | void>, falha: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const r = await run();
    if (r && r.ok) return { ok: true };
    return { ok: false, erro: (r && r.error) || falha };
  } catch (e) {
    if (redirectOk(e)) return { ok: true };
    if (isRedirectError(e)) return { ok: false, erro: REDIRECT_RECUSADO };
    throw e;
  }
}

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

/**
 * Apagar por action que sempre redireciona (ou devolve erro): confere no banco, com a sessão, que a linha sumiu
 * (deleteTransaction/deleteGoal não dizem se apagaram).
 */
async function apagarConferindo(table: string, id: string, run: () => Promise<{ error?: string } | null | void>): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const r = await run();
    if (r && r.error) return { ok: false, erro: r.error };
  } catch (e) {
    if (isRedirectError(e) && !redirectOk(e)) return { ok: false, erro: REDIRECT_RECUSADO };
    if (!isRedirectError(e)) throw e;
  }
  const db = await createClient();
  const { data, error } = await db.from(table).select("id").eq("id", id).maybeSingle();
  if (error) return { ok: false, erro: "Não consegui conferir se foi apagado. Confira na tela." };
  return data ? { ok: false, erro: "Não foi possível apagar." } : { ok: true };
}

const DELETE: Record<string, DeleteFn> = {
  "casa/tarefas": deleteChore,
  "casa/compras": deleteShoppingItem,
  "casa/manutencao": deleteMaintenance,
  "casa/documentos": deleteCasaDocument, // remove o arquivo do storage, como a tela
  "casa/cardapio": deleteMeal,
  "casa/prestadores": deleteProvider,
  "pet/saude": deletePetHealth, // idem
  "pet/veterinario": deletePetVet, // idem
  "pet/cuidados": deletePetCare,
  "pet/peso": deletePetWeight,
  "pet/racao": deletePetFood,
  "igreja/palavras": deleteWord,
  "igreja/promessas": deleteWord,
  "igreja/oracoes": deletePrayer,
  "igreja/propositos": deletePurpose,
  "igreja/carisma": deleteLesson, // arquivos e pasta vão para a lixeira do Drive, como a tela
  "saude/consultas": deleteAppointment, // tira o evento da Agenda (Google), como a tela
  "saude/exames": deleteExam, // remove o arquivo do storage, como a tela
  "saude/vacinas": deleteVaccine, // idem
  "saude/procedimentos": deleteProcedure, // idem
  "saude/medicamentos": deleteMedication,
  "saude/carteirinhas": deleteCard, // idem
  "agenda/eventos": async (id) => deleteAgendaEvent(id), // apaga no Google Calendar, como a tela
  "financas/contas_fixas": (id) => apagarConferindo("fin_bills", id, () => deleteBill(null, form({ id }))),
  "financas/contas_avulsas": (id) => apagarConferindo("fin_one_off_bills", id, () => deleteOneOff(null, form({ id }))),
  "financas/metas": (id) => apagarConferindo("fin_goals", id, () => deleteGoal(form({ id }))),
  "financas/lancamentos": (id) => apagarConferindo("fin_transactions", id, () => deleteTransaction(form({ id }))),
};

export type ExecResult = { ok: true; aviso?: string } | { ok: false; erro: string };

/** "Marcar paga" / "desfazer pagamento" de conta fixa ou avulsa, pelas actions da tela Contas fixas. */
async function concluirConta(key: string, raw: Record<string, string | string[]>): Promise<ExecResult> {
  const v = (k: string) => String(raw[k] ?? "");
  const fixa = key === "financas/contas_fixas";
  if (v("desfazer") === "true") {
    if (fixa) {
      const r = await apagarConferindo("fin_bill_payments", v("id"), async () => void (await undoPayment(form({ id: v("id"), month: v("month") }))));
      return r.ok ? { ok: true } : { ok: false, erro: "Não foi possível desfazer o pagamento." };
    }
    // Avulsa: sem redirect de sucesso a conferir; o pagamento sai se paid_on voltou a ser nulo.
    try {
      await undoOneOffPayment(form({ id: v("id") }));
    } catch (e) {
      if (!isRedirectError(e)) throw e;
    }
    const db = await createClient();
    const { data, error } = await db.from("fin_one_off_bills").select("paid_on").eq("id", v("id")).maybeSingle();
    return !error && data && data.paid_on === null ? { ok: true } : { ok: false, erro: "Não foi possível desfazer o pagamento." };
  }
  if (fixa) return rodar(() => payBill(null, form({ bill_id: v("id"), month: v("month"), transaction_id: v("transaction_id"), paid_on: v("paid_on"), amount: v("amount") })), "Não foi possível registrar o pagamento.");
  return rodar(() => payOneOff(null, form({ one_off_id: v("id"), transaction_id: v("transaction_id"), paid_on: v("paid_on") })), "Não foi possível registrar o pagamento.");
}

/** Grava pelo caminho da tela. `prep` vem de prepararAlteracao feito AGORA (no Confirmar), nunca do cliente. */
export async function executarAlteracao(prep: Extract<Prepared, { ok: true }>): Promise<ExecResult> {
  const { plan, row } = prep;
  const key = `${plan.preview.aba}/${plan.preview.secao}`;
  const id = plan.preview.id;
  switch (plan.preview.acao) {
    case "apagar": {
      // Orçamento: a tela remove salvando o valor vazio.
      if (key === "financas/orcamento") {
        // saveBudget ignora o erro do delete e devolve ok: relê a linha e só dá ok se ela sumiu.
        const r = await rodar(() => saveBudget(null, form({ category_id: String(plan.raw.category_id), scope: String(plan.raw.scope), month: String(plan.raw.month), amount: "" })), "Não foi possível apagar.");
        if (!r.ok) return r;
        const db = await createClient();
        // A linha foi achada no preparo (RLS da família); relê por categoria e mês, com a sessão.
        let q = db.from("fin_budgets").select("id").eq("category_id", String(plan.raw.category_id));
        q = plan.raw.scope === "mes" ? q.eq("month", String(plan.raw.month)) : q.is("month", null);
        const { data, error } = await q.maybeSingle();
        if (error) return { ok: false, erro: "Não consegui conferir se foi apagado. Confira na tela." };
        return data ? { ok: false, erro: "Não foi possível apagar." } : { ok: true };
      }
      const r = await DELETE[key](id!);
      return r.ok ? { ok: true, ...(r.aviso ? { aviso: r.aviso } : {}) } : { ok: false, erro: r.erro ?? "Não foi possível apagar." };
    }
    case "concluir": {
      const fail = (erro?: string) => ({ ok: false as const, erro: erro ?? "Não foi possível registrar." });
      if (key === "casa/tarefas") {
        // Estado lido agora: o "Feita" da tela confere índice e data (outro celular pode ter marcado antes).
        const r = await completeChore(id!, { next_index: Number(row?.next_index ?? 0), next_due_on: (row?.next_due_on as string | null) ?? null });
        return r.ok ? { ok: true } : fail(r.erro);
      }
      if (key === "casa/compras") {
        const r = await toggleShoppingItem(id!, plan.raw.done === "true");
        return r.ok ? { ok: true } : fail(r.erro);
      }
      if (key === "saude/consultas") {
        const r = await setAppointmentStatus(id!, plan.raw.status as "agendada" | "realizada" | "cancelada");
        return r.ok ? { ok: true } : fail(r.erro);
      }
      if (key === "saude/medicamentos") {
        const r = await setMedicationActive(id!, plan.raw.active === "true");
        return r.ok ? { ok: true } : fail(r.erro);
      }
      if (key === "financas/contas_fixas" || key === "financas/contas_avulsas") return concluirConta(key, plan.raw);
      const done = key === "casa/manutencao" ? markMaintenanceDone : key === "pet/cuidados" ? markPetCareDone : null;
      if (!done) return fail("Não dá para concluir este item.");
      const fd = new FormData();
      for (const [k, v] of planToFormEntries(plan)) fd.append(k, v);
      const r = await done(null, fd);
      return r?.ok ? { ok: true } : fail(r?.error);
    }
    default: {
      const fd = new FormData();
      for (const [k, v] of planToFormEntries(plan)) fd.append(k, v);
      return rodar(() => SAVE[key](null, fd), "Não foi possível salvar.");
    }
  }
}
