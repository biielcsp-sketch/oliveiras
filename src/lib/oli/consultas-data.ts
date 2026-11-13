import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { getAppContext } from "@/lib/data";
import { getFinanceBase } from "@/lib/financas/data";
import { getBillPayments, getBills, getBudgetRows, getGoals, getOneOffBillsForMonth, getTransactionsAround } from "@/lib/financas/planning-data";
import { getConfirmedBillDocs } from "@/lib/financas/documentos/data";
import { currentMonth, monthLabel, monthRange } from "@/lib/financas/period";
import { addDays, brDate, spMidnightIso } from "@/lib/agenda/dates";
import { mondayOf } from "@/lib/casa/menu";
import type { Transaction } from "@/lib/financas/types";
import { buildContasAPagar } from "./panels";
import {
  buildAula,
  buildBusca,
  buildCasa,
  buildFinAvulsas,
  buildFinCategorias,
  buildFinContasFixas,
  buildFinMetas,
  buildFinOrcamento,
  buildFinPeriodo,
  buildIgreja,
  buildPet,
  buildSaude,
  comCorte,
  FIN_INCOMPLETO,
  consulta,
  MAX_BUSCA_POR_ABA,
  visibleToMe,
  type AulaFileRow,
  type AulaRow,
  type BuscaHit,
  type CasaRows,
  type ConsultaData,
  type Corte,
  type IgrejaRows,
  type PetRows,
  type SaudeRows,
} from "./consultas";
import {
  arquivoRef,
  matchByName,
  type ConsultarCasaArgs,
  type ConsultarFinancasArgs,
  type ConsultarIgrejaArgs,
  type ConsultarPetArgs,
  type ConsultarSaudeArgs,
} from "./tool-args";

/**
 * Consultas de leitura do Oli por aba. Sempre com a sessão do usuário (createClient + RLS) e filtrando a
 * família de getAppContext (auth.getClaims). Reaproveita as funções de dados das telas quando existem
 * (Finanças); nas outras abas usa as mesmas tabelas e colunas das telas. Nunca seleciona token, caminho de
 * arquivo para fora (só para saber se existe) nem ids de terceiros.
 */
type Ctx = Awaited<ReturnType<typeof getAppContext>>;
type Db = Awaited<ReturnType<typeof createClient>>;
type Result = { ok: true; data: ConsultaData } | { ok: false; erro: string };

const LIMIT = 60;
/** Linhas sem tipo gerado (tabelas sem tipos do Supabase). */
const rowsOf = (data: unknown) => (data ?? []) as Record<string, unknown>[];
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const names = (ctx: Ctx) => new Map(ctx.members.map((m) => [m.id, m.name]));
/** Termo para ilike: % e _ viram literais. */
const like = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
/** Termo para .or(): sem os separadores da sintaxe do PostgREST (vírgula, parênteses, aspas, dois-pontos). */
const orLike = (t: string) => like(t.replace(/[,()"':*\\]/g, " ").replace(/\s+/g, " ").trim());

/** Registra corte quando o count exato do banco passa do que veio. */
function cut(cortes: Corte[], rotulo: string, rows: unknown[] | null | undefined, count: number | null | undefined) {
  const n = rows?.length ?? 0;
  if (typeof count === "number" && count > n) cortes.push({ rotulo, mostrados: n, total: count });
}

/* ---------- Finanças ---------- */

const TX_COLS = "id, account_id, date, description, amount, category_id, member_id, notes, source";
const TX_PAGE = 1000;
/** Teto de segurança (10 páginas). Acima disso a resposta não traz totais (FIN_INCOMPLETO). */
export const TX_MAX_PAGES = 10;

/**
 * Todos os lançamentos do período (de/até inclusivos), paginando até o fim: os totais saem de TODAS as linhas.
 * `completo` = false só se passar do teto de páginas.
 */
async function allTransactions(db: Db, householdId: string, de: string, ate: string, busca?: string) {
  const txs: Transaction[] = [];
  for (let page = 0; page < TX_MAX_PAGES; page++) {
    let q = db
      .from("fin_transactions")
      .select(TX_COLS)
      .eq("household_id", householdId)
      .gte("date", de)
      .lte("date", ate)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * TX_PAGE, page * TX_PAGE + TX_PAGE - 1);
    if (busca) q = q.ilike("description", like(busca));
    const { data, error } = await q;
    if (error) throw new Error("lançamentos: consulta falhou");
    const rows = (data ?? []) as unknown as Transaction[];
    txs.push(...rows.map((t) => ({ ...t, amount: Number(t.amount) })));
    if (rows.length < TX_PAGE) return { txs, completo: true };
  }
  return { txs, completo: false };
}

const monthBounds = (month: string) => {
  const r = monthRange(month);
  return { de: r.start, ate: addDays(r.end, -1) };
};

export async function consultarFinancas(ctx: Ctx, a: ConsultarFinancasArgs, today: string): Promise<Result> {
  const month = a.mes ?? currentMonth();
  const db = await createClient();
  switch (a.secao) {
    case "periodo": {
      const { accounts, categories } = await getFinanceBase();
      // de/até já vêm completos e limitados a 92 dias pelo parser; sem eles, o mês.
      const { de, ate } = a.de && a.ate ? { de: a.de, ate: a.ate } : monthBounds(month);
      const rotulo = a.de && a.ate ? `${brDate(de)} a ${brDate(ate)}` : monthLabel(month);
      const { txs, completo } = await allTransactions(db, ctx.household.id, de, ate, a.busca);
      return { ok: true, data: buildFinPeriodo({ de, ate, rotulo, txs, accounts, categories, busca: a.busca, completo }) };
    }
    case "metas": {
      const [{ accounts }, goals] = await Promise.all([getFinanceBase(), getGoals()]);
      return { ok: true, data: buildFinMetas(goals, accounts, today) };
    }
    case "orcamento": {
      const { de, ate } = monthBounds(month);
      const [{ accounts, categories }, all, rows] = await Promise.all([getFinanceBase(), allTransactions(db, ctx.household.id, de, ate), getBudgetRows()]);
      const d = buildFinOrcamento(month, rows, all.txs, categories, accounts);
      return { ok: true, data: all.completo ? d : { ...d, aviso: FIN_INCOMPLETO } };
    }
    case "contas_fixas": {
      // Mesma montagem de contas_a_pagar (tela Contas fixas), para o mês pedido; avulsas ficam na outra seção.
      const { accounts, categories } = await getFinanceBase();
      const cards = accounts.filter((x) => x.kind === "cartao" && !x.archived && x.closing_day && x.due_day);
      const [bills, payments, cardTxs, billDocs] = await Promise.all([
        getBills(),
        getBillPayments(month),
        getTransactionsAround(month, cards.map((c) => c.id)),
        getConfirmedBillDocs(month),
      ]);
      const d = buildContasAPagar({ month, today, bills, payments, accounts, categories, cardTxs, billDocs, oneOffs: [] });
      return { ok: true, data: buildFinContasFixas(month, d.contas.filter((c) => !c.avulsa)) };
    }
    case "contas_avulsas":
      return { ok: true, data: buildFinAvulsas(month, await getOneOffBillsForMonth(month), today) };
    case "categorias": {
      const { de, ate } = monthBounds(month);
      const [{ accounts, categories }, all] = await Promise.all([getFinanceBase(), allTransactions(db, ctx.household.id, de, ate)]);
      const d = buildFinCategorias(month, categories, all.txs, accounts);
      return { ok: true, data: all.completo ? d : { ...d, aviso: FIN_INCOMPLETO } };
    }
  }
}

/* ---------- Saúde ---------- */

/**
 * Saúde é COMPARTILHADA entre os adultos da família (0010_saude.sql: RLS só por família, sem dono por item) e as
 * telas mostram tudo, com filtro opcional por pessoa. O Oli segue exatamente isso: mesmas tabelas, mesma família.
 */
export async function consultarSaude(ctx: Ctx, a: ConsultarSaudeArgs, today: string): Promise<Result> {
  let memberId: string | null = null;
  let pessoa: string | null = null;
  if (a.pessoa) {
    const found = /^(eu|mim|minha|meu)$/i.test(a.pessoa.trim()) ? ctx.me : matchByName(ctx.members, a.pessoa);
    if (!found) return { ok: false, erro: `Pessoa não encontrada. Opções: ${ctx.members.map((m) => m.name).join(", ")}.` };
    memberId = found.id;
    pessoa = found.name;
  }
  const db = await createClient();
  const hh = ctx.household.id;
  const s = a.secao;
  const want = (k: string) => s === "resumo" || s === k;
  // count exato em toda consulta limitada: se o banco tem mais do que veio, a resposta avisa (comCorte).
  const base = (table: string, cols: string) => {
    let q = db.from(table).select(cols, { count: "exact" }).eq("household_id", hh);
    if (memberId) q = q.eq("member_id", memberId);
    return q;
  };
  const dated = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q, col: string) => {
    let r = q;
    if (a.de) r = r.gte(col, a.de);
    if (a.ate) r = r.lte(col, a.ate);
    return r;
  };
  const rows: SaudeRows = {};
  const cortes: Corte[] = [];
  const jobs: Promise<void>[] = [];
  let periodo: string | null = a.de && a.ate ? `${a.de} a ${a.ate}` : null;
  type Appt = NonNullable<SaudeRows["consultas"]>;
  const APPT = "id, member_id, kind, specialty, doctor, place, starts_at, status, notes";

  if (s === "resumo") {
    // Próximas consultas: de agora em diante, a mais cedo primeiro.
    jobs.push(
      (async () => {
        const { data, count } = await base("health_appointments", APPT)
          .gte("starts_at", new Date().toISOString())
          .lt("starts_at", spMidnightIso(addDays(today, 181)))
          .order("starts_at", { ascending: true })
          .limit(20);
        rows.consultas = (data ?? []) as unknown as Appt;
        cut(cortes, "próximas consultas", data, count);
      })(),
    );
  }
  if (s === "consultas") {
    // Janela padrão: últimos 90 dias e próximos 180. Dentro dela: as próximas (mais cedo primeiro) e as passadas
    // (mais recente primeiro), cada uma com seu limite; assim um "de" antigo nunca esconde as recentes.
    const de = a.de ?? addDays(today, -90);
    const ate = a.ate ?? addDays(today, 180);
    periodo = `${de} a ${ate}`;
    const nowIso = new Date().toISOString();
    const win = () => base("health_appointments", APPT).gte("starts_at", spMidnightIso(de)).lt("starts_at", spMidnightIso(addDays(ate, 1)));
    jobs.push(
      (async () => {
        const [next, past] = await Promise.all([
          win().gte("starts_at", nowIso).order("starts_at", { ascending: true }).limit(30),
          win().lt("starts_at", nowIso).order("starts_at", { ascending: false }).limit(30),
        ]);
        rows.consultas = [...((next.data ?? []) as unknown as Appt), ...((past.data ?? []) as unknown as Appt)];
        cut(cortes, "próximas consultas", next.data, next.count);
        cut(cortes, "consultas passadas", past.data, past.count);
      })(),
    );
  }
  if (want("exames"))
    jobs.push(
      (async () => {
        const { data, count } = await dated(base("health_exams", "id, member_id, name, exam_date, lab, requested_by, result_summary, file_path"), "exam_date")
          .order("exam_date", { ascending: false, nullsFirst: false })
          .limit(s === "resumo" ? 5 : LIMIT);
        rows.exames = (data ?? []) as unknown as SaudeRows["exames"];
        if (s !== "resumo") cut(cortes, "exames", data, count);
      })(),
    );
  if (want("vacinas"))
    jobs.push(
      (async () => {
        let q = dated(base("health_vaccines", "id, member_id, name, dose_label, applied_on, next_dose_on, place, file_path"), "applied_on");
        if (s === "resumo") q = q.not("next_dose_on", "is", null).order("next_dose_on", { ascending: true });
        else q = q.order("applied_on", { ascending: false, nullsFirst: false });
        const { data, count } = await q.limit(LIMIT);
        rows.vacinas = (data ?? []) as unknown as SaudeRows["vacinas"];
        cut(cortes, "vacinas", data, count);
      })(),
    );
  if (s === "procedimentos")
    jobs.push(
      (async () => {
        const { data, count } = await dated(base("health_procedures", "id, member_id, name, performed_on, place, doctor, notes, file_path"), "performed_on")
          .order("performed_on", { ascending: false, nullsFirst: false })
          .limit(LIMIT);
        rows.procedimentos = (data ?? []) as unknown as SaudeRows["procedimentos"];
        cut(cortes, "procedimentos", data, count);
      })(),
    );
  if (want("medicamentos"))
    jobs.push(
      (async () => {
        let q = base("health_medications", "id, member_id, name, dosage, frequency, started_on, ended_on, active, prescribed_by, reminder_times");
        if (s === "resumo") q = q.eq("active", true);
        const { data, count } = await q.order("active", { ascending: false }).order("name").limit(LIMIT);
        rows.medicamentos = (data ?? []) as unknown as SaudeRows["medicamentos"];
        cut(cortes, "medicamentos", data, count);
      })(),
    );
  if (s === "carteirinhas")
    jobs.push(
      (async () => {
        const { data, count } = await base("health_insurance_cards", "id, member_id, operator, card_number, plan_name, valid_until, file_path").order("created_at").limit(LIMIT);
        rows.carteirinhas = (data ?? []) as unknown as SaudeRows["carteirinhas"];
        cut(cortes, "carteirinhas", data, count);
      })(),
    );
  await Promise.all(jobs);
  return { ok: true, data: comCorte(buildSaude(s, rows, names(ctx), { busca: a.busca, pessoa, today, periodo }), cortes) };
}

/* ---------- Casa ---------- */

export async function consultarCasa(ctx: Ctx, a: ConsultarCasaArgs, today: string): Promise<Result> {
  const db = await createClient();
  const hh = ctx.household.id;
  const s = a.secao;
  const want = (k: string) => s === "resumo" || s === k;
  const rows: CasaRows = {};
  const cortes: Corte[] = [];
  const jobs: Promise<void>[] = [];
  let periodo: string | null = null;
  const run = (k: keyof CasaRows, table: string, cols: string, order: string, extra?: (q: ReturnType<typeof sel>) => ReturnType<typeof sel>) => {
    jobs.push(
      (async () => {
        let q = sel(table, cols);
        if (extra) q = extra(q);
        // Ordem: o mais próximo/relevante primeiro (vencimento, dia); count exato para avisar se cortou.
        const { data, count } = await q.order(order, { ascending: true, nullsFirst: false }).limit(k === "compras" || k === "cardapio" ? 100 : LIMIT);
        cut(cortes, k, data, count);
        rows[k] = rowsOf(data).map((r) => ({ ...r, ...(r.amount !== undefined ? { amount: num(r.amount) } : {}), ...(r.quantity !== undefined ? { quantity: num(r.quantity) } : {}) })) as never;
      })(),
    );
  };
  const sel = (table: string, cols: string) => db.from(table).select(cols, { count: "exact" }).eq("household_id", hh);

  if (want("tarefas")) run("tarefas", "casa_chores", "id, name, notes, frequency, rotation, next_index, next_due_on, active", "next_due_on", (q) => q.eq("active", true));
  if (want("compras")) run("compras", "casa_shopping_items", "id, name, quantity, unit, category, notes, done", "created_at", (q) => q.eq("done", false));
  if (want("manutencao")) run("manutencao", "casa_maintenance", "id, name, notes, interval_value, interval_unit, last_done_on, next_due_on, provider, active", "next_due_on", (q) => q.eq("active", true));
  if (want("documentos"))
    run("documentos", "casa_documents", "id, kind, title, product, store, purchase_date, warranty_until, amount, notes, file_path", "title", (q) =>
      s === "resumo" ? q.not("warranty_until", "is", null) : q,
    );
  if (s === "cardapio") {
    const monday = mondayOf(a.data ?? today);
    const sunday = addDays(monday, 6);
    periodo = `${monday} a ${sunday}`;
    run("cardapio", "casa_meal_plan", "id, day, meal, title, ingredients, notes", "day", (q) => q.gte("day", monday).lte("day", sunday));
  }
  if (s === "prestadores") run("prestadores", "casa_providers", "id, name, service, phone, notes", "name");
  await Promise.all(jobs);
  return { ok: true, data: comCorte(buildCasa(s, rows, names(ctx), { today, busca: a.busca, periodo }), cortes) };
}

/* ---------- Pet ---------- */

export async function consultarPet(ctx: Ctx, a: ConsultarPetArgs, today: string): Promise<Result> {
  const db = await createClient();
  const hh = ctx.household.id;
  const cortes: Corte[] = [];
  const { data: petRows, count: petCount } = await db
    .from("casa_pets")
    .select("id, name, species, breed, sex, birth_date, notes", { count: "exact" })
    .eq("household_id", hh)
    .order("name")
    .limit(20);
  cut(cortes, "pets", petRows, petCount);
  let pets = (petRows ?? []) as PetRows["pets"];
  if (a.pet) {
    const found = matchByName(pets, a.pet);
    if (!found) return { ok: false, erro: pets.length ? `Pet não encontrado. Opções: ${pets.map((p) => p.name).join(", ")}.` : "Nenhum pet cadastrado." };
    pets = [found];
  }
  const ids = pets.map((p) => p.id);
  const rows: PetRows = { pets };
  if (ids.length) {
    const s = a.secao;
    const want = (k: string) => s === "resumo" || s === k;
    const q = (table: string, cols: string) => db.from(table).select(cols, { count: "exact" }).eq("household_id", hh).in("pet_id", ids);
    const jobs: PromiseLike<void>[] = [];
    if (want("saude"))
      jobs.push(
        q("casa_pet_health", "id, pet_id, kind, name, dose, applied_on, next_due_on, notes, file_path")
          .order("applied_on", { ascending: false, nullsFirst: false })
          .limit(LIMIT)
          .then(({ data, count }) => void (cut(cortes, "saúde do pet", data, count), rows.saude = (data ?? []) as unknown as PetRows["saude"])),
      );
    if (s === "veterinario")
      jobs.push(
        q("casa_pet_vet", "id, pet_id, kind, happened_on, clinic, vet, reason, notes, cost, file_path")
          .order("happened_on", { ascending: false })
          .limit(LIMIT)
          .then(({ data, count }) => void (cut(cortes, "veterinário", data, count), rows.veterinario = rowsOf(data).map((r) => ({ ...r, cost: num(r.cost) })) as unknown as PetRows["veterinario"])),
      );
    if (want("cuidados"))
      jobs.push(
        q("casa_pet_care", "id, pet_id, name, interval_value, interval_unit, last_done_on, next_due_on, active, notes")
          .eq("active", true)
          .order("next_due_on", { ascending: true, nullsFirst: false })
          .limit(LIMIT)
          .then(({ data, count }) => void (cut(cortes, "cuidados", data, count), rows.cuidados = (data ?? []) as unknown as PetRows["cuidados"])),
      );
    if (want("peso"))
      jobs.push(
        q("casa_pet_weights", "id, pet_id, measured_on, weight_kg")
          .order("measured_on", { ascending: false })
          .limit(30)
          .then(({ data, count }) => void (cut(cortes, "pesagens", data, count), rows.peso = rowsOf(data).map((r) => ({ ...r, weight_kg: Number(r.weight_kg) })) as unknown as PetRows["peso"])),
      );
    if (want("racao"))
      jobs.push(
        q("casa_pet_food", "id, pet_id, brand, bag_kg, daily_grams, started_on, active, notes")
          .order("started_on", { ascending: false })
          .limit(20)
          .then(({ data, count }) => void (cut(cortes, "rações", data, count), rows.racao = rowsOf(data).map((r) => ({ ...r, bag_kg: Number(r.bag_kg) })) as unknown as PetRows["racao"])),
      );
    await Promise.all(jobs);
  }
  return { ok: true, data: comCorte(buildPet(a.secao, rows, today), cortes) };
}

/* ---------- Igreja ---------- */

/** RLS da Igreja: dono ou compartilhado (0023_igreja.sql). Consolidação ainda não tem dados (só a tela). */
export async function consultarIgreja(ctx: Ctx, a: ConsultarIgrejaArgs): Promise<Result> {
  const db = await createClient();
  const hh = ctx.household.id;
  const uid = ctx.user.id;
  const people = ctx.members.map((m) => ({ user_id: m.user_id, name: m.name }));
  const LESSON = "id, owner_id, shared, title, lesson_date, subject, teacher, notes, summary, summary_status";
  const FILE = "id, lesson_id, display_name, file_mime, status";
  if (a.aula) {
    const [{ data: lesson }, { data: files, count: fileCount }] = await Promise.all([
      db.from("igreja_carisma_lessons").select(LESSON).eq("household_id", hh).eq("id", a.aula).maybeSingle(),
      db.from("igreja_carisma_files").select(FILE, { count: "exact" }).eq("household_id", hh).eq("lesson_id", a.aula).eq("status", "pronto").order("created_at").limit(40),
    ]);
    const aulaCortes: Corte[] = [];
    cut(aulaCortes, "arquivos da aula", files, fileCount);
    return { ok: true, data: comCorte(buildAula((lesson as AulaRow | null) ?? null, (files ?? []) as AulaFileRow[], uid, people), aulaCortes) };
  }
  const s = a.secao;
  if (s === "consolidacao") return { ok: true, data: buildIgreja(s, {}, uid, people) };
  const want = (k: string) => s === "resumo" || s === k;
  const rows: IgrejaRows = {};
  const jobs: PromiseLike<void>[] = [];
  const cortes: Corte[] = [];
  const t = (table: string, cols: string) => db.from(table).select(cols, { count: "exact" }).eq("household_id", hh);
  if (want("palavras") || want("promessas")) {
    let q = t("igreja_words", "id, owner_id, shared, kind, title, body, received_on, reference, fulfilled_on");
    if (s === "palavras") q = q.eq("kind", "anotacao");
    if (s === "promessas" || s === "resumo") q = q.eq("kind", "promessa");
    jobs.push(q.order("received_on", { ascending: false }).limit(LIMIT).then(({ data, count }) => void (cut(cortes, "palavras", data, count), rows.palavras = (data ?? []) as unknown as IgrejaRows["palavras"])));
  }
  if (want("oracoes"))
    jobs.push(
      t("igreja_prayers", "id, owner_id, shared, title, person, details, status, answered_on, answer_notes")
        .order("created_at", { ascending: false })
        .limit(LIMIT)
        .then(({ data, count }) => void (cut(cortes, "orações", data, count), rows.oracoes = (data ?? []) as unknown as IgrejaRows["oracoes"])),
    );
  if (want("propositos"))
    jobs.push(
      t("igreja_purposes", "id, owner_id, shared, title, description, status, starts_on, ends_on, notes")
        .order("created_at", { ascending: false })
        .limit(LIMIT)
        .then(({ data, count }) => void (cut(cortes, "propósitos", data, count), rows.propositos = (data ?? []) as unknown as IgrejaRows["propositos"])),
    );
  if (want("carisma")) {
    jobs.push(
      t("igreja_carisma_lessons", LESSON)
        .order("lesson_date", { ascending: false, nullsFirst: false })
        .limit(LIMIT)
        .then(({ data, count }) => void (cut(cortes, "aulas", data, count), rows.aulas = (data ?? []) as unknown as IgrejaRows["aulas"])),
    );
    jobs.push(t("igreja_carisma_files", FILE).eq("status", "pronto").limit(500).then(({ data, count }) => void (cut(cortes, "arquivos das aulas", data, count), rows.arquivos = (data ?? []) as unknown as IgrejaRows["arquivos"])));
  }
  await Promise.all(jobs);
  return { ok: true, data: comCorte(buildIgreja(s, rows, uid, people, a.busca), cortes) };
}

/* ---------- Busca em todo o app ---------- */

type Spec = {
  aba: string;
  table: string;
  cols: string;
  fields: string[];
  map: (r: Record<string, unknown>) => BuscaHit | null;
  owned?: boolean;
};

const fmtTime = (iso: unknown) => (typeof iso === "string" ? iso : null);

const SPECS = (ctx: Ctx): Spec[] => {
  const who = names(ctx);
  const memberName = (r: Record<string, unknown>) => (typeof r.member_id === "string" ? (who.get(r.member_id) ?? null) : null);
  return [
    { aba: "Finanças: lançamentos", table: "fin_transactions", cols: "description, date, amount", fields: ["description"], map: (r) => ({ aba: "", titulo: r.description, data: r.date as string, valor: num(r.amount) }) },
    { aba: "Finanças: contas fixas", table: "fin_bills", cols: "name, amount, due_day, active", fields: ["name"], map: (r) => ({ aba: "", titulo: r.name, valor: num(r.amount), detalhe: `Vence todo dia ${r.due_day}${r.active ? "" : " (inativa)"}` }) },
    { aba: "Finanças: contas avulsas", table: "fin_one_off_bills", cols: "name, amount, due_date, paid_on", fields: ["name"], map: (r) => ({ aba: "", titulo: r.name, valor: num(r.amount), data: r.due_date as string, detalhe: r.paid_on ? "paga" : "em aberto" }) },
    { aba: "Finanças: metas", table: "fin_goals", cols: "name, target, target_date", fields: ["name"], map: (r) => ({ aba: "", titulo: r.name, valor: num(r.target), data: (r.target_date as string) ?? null }) },
    { aba: "Finanças: documentos", table: "fin_documents", cols: "id, kind, payee, amount, due_date, status, file_path", fields: ["payee"], map: (r) => (r.status === "descartado" ? null : { aba: "", titulo: r.payee, valor: num(r.amount), data: (r.due_date as string) ?? null, detalhe: r.kind, arquivo: r.file_path ? arquivoRef("financas", r.id as string) : null }) },
    { aba: "Saúde: consultas", table: "health_appointments", cols: "member_id, kind, specialty, doctor, starts_at, status", fields: ["specialty", "doctor", "place"], map: (r) => ({ aba: "", titulo: [r.kind === "retorno" ? "Retorno" : "Consulta", r.specialty].filter(Boolean).join(" · "), data: fmtTime(r.starts_at)?.slice(0, 10) ?? null, detalhe: [memberName(r), r.doctor, r.status].filter(Boolean).join(" · ") }) },
    { aba: "Saúde: exames", table: "health_exams", cols: "id, member_id, name, exam_date, file_path", fields: ["name", "lab"], map: (r) => ({ aba: "", titulo: r.name, data: (r.exam_date as string) ?? null, detalhe: memberName(r), arquivo: r.file_path ? arquivoRef("exame", r.id as string) : null }) },
    { aba: "Saúde: vacinas", table: "health_vaccines", cols: "id, member_id, name, applied_on, file_path", fields: ["name"], map: (r) => ({ aba: "", titulo: r.name, data: (r.applied_on as string) ?? null, detalhe: memberName(r), arquivo: r.file_path ? arquivoRef("vacina", r.id as string) : null }) },
    { aba: "Saúde: procedimentos", table: "health_procedures", cols: "id, member_id, name, performed_on, file_path", fields: ["name", "doctor"], map: (r) => ({ aba: "", titulo: r.name, data: (r.performed_on as string) ?? null, detalhe: memberName(r), arquivo: r.file_path ? arquivoRef("procedimento", r.id as string) : null }) },
    { aba: "Saúde: medicamentos", table: "health_medications", cols: "member_id, name, dosage, active", fields: ["name"], map: (r) => ({ aba: "", titulo: r.name, detalhe: [memberName(r), r.dosage, r.active ? "em uso" : "encerrado"].filter(Boolean).join(" · ") }) },
    { aba: "Casa: compras", table: "casa_shopping_items", cols: "id, name, done", fields: ["name"], map: (r) => (r.done ? null : { aba: "", id: r.id as string, titulo: r.name, detalhe: "na lista de compras" }) },
    { aba: "Casa: tarefas", table: "casa_chores", cols: "id, name, next_due_on, active", fields: ["name"], map: (r) => (r.active ? { aba: "", id: r.id as string, titulo: r.name, data: (r.next_due_on as string) ?? null } : null) },
    { aba: "Casa: manutenção", table: "casa_maintenance", cols: "id, name, next_due_on, active", fields: ["name", "provider"], map: (r) => (r.active ? { aba: "", id: r.id as string, titulo: r.name, data: (r.next_due_on as string) ?? null } : null) },
    { aba: "Casa: documentos", table: "casa_documents", cols: "id, title, product, warranty_until, file_path", fields: ["title", "product", "store"], map: (r) => ({ aba: "", id: r.id as string, titulo: r.title, detalhe: [r.product, r.warranty_until ? `garantia até ${brDate(r.warranty_until as string)}` : null].filter(Boolean).join(" · "), arquivo: r.file_path ? arquivoRef("casa_documento", r.id as string) : null }) },
    { aba: "Casa: prestadores", table: "casa_providers", cols: "id, name, service, phone", fields: ["name", "service"], map: (r) => ({ aba: "", id: r.id as string, titulo: r.name, detalhe: [r.service, r.phone].filter(Boolean).join(" · ") }) },
    { aba: "Casa: cardápio", table: "casa_meal_plan", cols: "id, day, title", fields: ["title"], map: (r) => ({ aba: "", id: r.id as string, titulo: r.title, data: r.day as string }) },
    { aba: "Pet", table: "casa_pet_health", cols: "id, name, kind, applied_on, next_due_on, file_path", fields: ["name"], map: (r) => ({ aba: "", id: r.id as string, titulo: r.name, data: (r.applied_on as string) ?? null, detalhe: r.next_due_on ? `próxima ${brDate(r.next_due_on as string)}` : r.kind, arquivo: r.file_path ? arquivoRef("pet_saude", r.id as string) : null }) },
    { aba: "Pet: veterinário", table: "casa_pet_vet", cols: "id, kind, reason, clinic, happened_on, file_path", fields: ["reason", "clinic", "vet"], map: (r) => ({ aba: "", id: r.id as string, titulo: r.reason ?? r.kind, data: r.happened_on as string, detalhe: r.clinic, arquivo: r.file_path ? arquivoRef("pet_veterinario", r.id as string) : null }) },
    { aba: "Igreja: palavras e promessas", table: "igreja_words", cols: "id, owner_id, shared, kind, title, body, received_on", fields: ["title", "body", "reference"], owned: true, map: (r) => ({ aba: "", id: r.id as string, titulo: r.title ?? r.body, data: r.received_on as string, detalhe: r.kind === "promessa" ? "promessa" : "palavra" }) },
    { aba: "Igreja: orações", table: "igreja_prayers", cols: "id, owner_id, shared, title, person, status", fields: ["title", "person", "details"], owned: true, map: (r) => ({ aba: "", id: r.id as string, titulo: r.title, detalhe: [r.person, r.status].filter(Boolean).join(" · ") }) },
    { aba: "Igreja: propósitos", table: "igreja_purposes", cols: "id, owner_id, shared, title, status", fields: ["title", "description"], owned: true, map: (r) => ({ aba: "", id: r.id as string, titulo: r.title, detalhe: r.status }) },
    { aba: "Igreja: aulas do Carisma", table: "igreja_carisma_lessons", cols: "id, owner_id, shared, title, lesson_date, subject", fields: ["title", "subject", "notes", "summary"], owned: true, map: (r) => ({ aba: "", id: r.id as string, titulo: r.title, data: (r.lesson_date as string) ?? null, detalhe: r.subject }) },
  ];
};

/** Busca por texto nos títulos/notas de todas as abas (RLS de cada tabela; Igreja ainda passa pela defesa visibleToMe). */
export async function buscarNoApp(ctx: Ctx, busca: string): Promise<Result> {
  const db = await createClient();
  const term = orLike(busca);
  if (term === "%%") return { ok: true, data: consulta("busca", "busca", `Busca: “${busca}”`, []) };
  const specs = SPECS(ctx);
  const cortes: Corte[] = [];
  const results = await Promise.all(
    specs.map(async (sp) => {
      const { data, error, count } = await db
        .from(sp.table)
        .select(sp.cols, { count: "exact" })
        .eq("household_id", ctx.household.id)
        .or(sp.fields.map((f) => `${f}.ilike.${term}`).join(","))
        .limit(MAX_BUSCA_POR_ABA);
      if (error || !data) return [] as BuscaHit[];
      // Igreja: o count do RLS já exclui o privado do outro; o corte só diz que há mais resultados.
      cut(cortes, sp.aba, data, count);
      let list = data as unknown as Record<string, unknown>[];
      if (sp.owned) list = visibleToMe(list as unknown as { owner_id: string; shared: boolean }[], ctx.user.id) as unknown as Record<string, unknown>[];
      return list
        .map(sp.map)
        .filter((h): h is BuscaHit => Boolean(h))
        .map((h) => ({ ...h, aba: sp.aba }));
    }),
  );
  return { ok: true, data: comCorte(buildBusca(busca, results.flat()), cortes) };
}
