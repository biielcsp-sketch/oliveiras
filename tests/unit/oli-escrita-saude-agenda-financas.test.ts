import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  argsDaAba,
  consultaAgendaAviso,
  contaFixaApagarAviso,
  desfazerAviso,
  eventoApagarAviso,
  lancamentoApagarAviso,
  OPEN_FINANCE_RECUSA,
  ORIGEM_DESCONHECIDA,
  parseAlterarArgs,
  planAlteracao,
  previewFingerprint,
  type AlterarAba,
  type AlterarLookup,
  type Row,
} from "@/lib/oli/alterar";
import { ALTERAR_TOOLS, OLI_PERSONA } from "@/lib/oli/prompt";
import { OliPanels } from "@/components/oli/oli-panels";

vi.mock("server-only", () => ({}));

/* ---------- Actions das telas simuladas ---------- */
const calls = vi.hoisted(() => ({ list: [] as { fn: string; arg: unknown }[], redirect: false, saveResult: { ok: true } as { ok?: boolean; error?: string } }));
const redirectError = () => Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/financas;307;" });
const rec = (fn: string, redirects = false) => async (...a: unknown[]) => {
  const last = a[a.length - 1];
  calls.list.push({ fn, arg: last instanceof FormData ? [...last.entries()] : a.length === 1 ? a[0] : a });
  if (redirects && calls.redirect) throw redirectError();
  return calls.saveResult;
};
const del = (fn: string) => async (id: string) => {
  calls.list.push({ fn, arg: id });
  return { ok: true };
};
vi.mock("@/app/(app)/casa/actions", () => ({
  saveChore: rec("saveChore"),
  saveShoppingItem: rec("saveShoppingItem"),
  saveMaintenance: rec("saveMaintenance"),
  deleteChore: del("deleteChore"),
  deleteShoppingItem: del("deleteShoppingItem"),
  deleteMaintenance: del("deleteMaintenance"),
  markMaintenanceDone: rec("markMaintenanceDone"),
  toggleShoppingItem: rec("toggleShoppingItem"),
  completeChore: rec("completeChore"),
}));
vi.mock("@/app/(app)/casa/documentos-actions", () => ({ saveCasaDocument: rec("saveCasaDocument"), deleteCasaDocument: del("deleteCasaDocument") }));
vi.mock("@/app/(app)/casa/cardapio-actions", () => ({ saveMeal: rec("saveMeal"), deleteMeal: del("deleteMeal") }));
vi.mock("@/app/(app)/casa/prestadores-actions", () => ({ saveProvider: rec("saveProvider"), deleteProvider: del("deleteProvider") }));
vi.mock("@/app/(app)/casa/pet-actions", () => ({
  savePetHealth: rec("savePetHealth"),
  savePetVet: rec("savePetVet"),
  savePetCare: rec("savePetCare"),
  markPetCareDone: rec("markPetCareDone"),
  savePetWeight: rec("savePetWeight"),
  savePetFood: rec("savePetFood"),
  deletePetHealth: del("deletePetHealth"),
  deletePetVet: del("deletePetVet"),
  deletePetCare: del("deletePetCare"),
  deletePetWeight: del("deletePetWeight"),
  deletePetFood: del("deletePetFood"),
}));
vi.mock("@/app/(app)/ministerio/devocional-actions", () => ({
  saveWord: rec("saveWord"),
  savePrayer: rec("savePrayer"),
  savePurpose: rec("savePurpose"),
  deleteWord: del("deleteWord"),
  deletePrayer: del("deletePrayer"),
  deletePurpose: del("deletePurpose"),
}));
vi.mock("@/app/(app)/ministerio/carisma-actions", () => ({ saveLesson: rec("saveLesson"), deleteLesson: del("deleteLesson") }));
vi.mock("@/app/(app)/saude/actions", () => ({
  saveAppointment: rec("saveAppointment"),
  saveExam: rec("saveExam"),
  saveVaccine: rec("saveVaccine"),
  saveProcedure: rec("saveProcedure"),
  saveMedication: rec("saveMedication"),
  saveCard: rec("saveCard"),
  setAppointmentStatus: async (id: string, status: string) => {
    calls.list.push({ fn: "setAppointmentStatus", arg: [id, status] });
    return { ok: true };
  },
  setMedicationActive: async (id: string, active: boolean) => {
    calls.list.push({ fn: "setMedicationActive", arg: [id, active] });
    return { ok: true };
  },
  deleteAppointment: del("deleteAppointment"),
  deleteExam: del("deleteExam"),
  deleteVaccine: del("deleteVaccine"),
  deleteProcedure: del("deleteProcedure"),
  deleteMedication: del("deleteMedication"),
  deleteCard: del("deleteCard"),
}));
vi.mock("@/app/(app)/agenda/actions", () => ({ saveEvent: rec("saveEvent"), deleteAgendaEvent: del("deleteAgendaEvent") }));
vi.mock("@/app/(app)/financas/actions", () => ({ saveTransaction: rec("saveTransaction", true), deleteTransaction: rec("deleteTransaction", true) }));
vi.mock("@/app/(app)/financas/planning-actions", () => ({
  saveBill: rec("saveBill", true),
  deleteBill: rec("deleteBill", true),
  payBill: rec("payBill", true),
  undoPayment: rec("undoPayment", true),
  saveGoal: rec("saveGoal", true),
  deleteGoal: rec("deleteGoal", true),
  saveBudget: rec("saveBudget"),
}));
vi.mock("@/app/(app)/financas/avulsas-actions", () => ({
  saveOneOff: rec("saveOneOff", true),
  deleteOneOff: rec("deleteOneOff", true),
  payOneOff: rec("payOneOff", true),
  undoOneOffPayment: rec("undoOneOffPayment", true),
}));

/* ---------- Banco falso: uma linha por tabela (maybeSingle) e contagens ---------- */
const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown> | null>,
  counts: {} as Record<string, number | null>,
  errors: {} as Record<string, boolean>,
  /** Depois do redirect da action, a linha some (apagar) ou continua (falha silenciosa). */
  removed: new Set<string>(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let head = false;
      const b: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => {
          head = Boolean(o?.head);
          return b;
        },
        eq: () => b,
        is: () => b,
        maybeSingle: async () => ({ data: db.removed.has(table) ? null : (db.rows[table] ?? null), error: db.errors[table] ? { message: "boom" } : null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(res(head ? { count: db.counts[table] === undefined ? 0 : db.counts[table], error: db.errors[table] ? { message: "boom" } : null } : { data: [], error: null })),
      };
      return b;
    },
  }),
}));
const fx = vi.hoisted(() => ({
  agendaOn: true,
  writable: [] as { id: string; summary: string; primary: boolean }[],
  calendars: [] as unknown[],
  accounts: [] as unknown[],
  fin: { accounts: [] as unknown[], categories: [] as unknown[] },
}));
vi.mock("@/lib/google/agenda", () => ({
  agendaEnabled: () => fx.agendaOn,
  loadAccounts: async () => ({ accounts: fx.accounts, calendars: fx.calendars }),
  writableCalendarsOf: () => fx.writable,
}));
vi.mock("@/lib/financas/data", () => ({ getFinanceBase: async () => fx.fin }));
vi.mock("@/lib/financas/baixa-data", () => ({ transactionUses: async () => ({ fixed: [], oneOff: [] }) }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = { id: U(1), name: "Gabriel", user_id: U(101) };
const KAREN = { id: U(2), name: "Karen", user_id: U(102) };
const CONTA = { id: U(30), name: "Conta Itaú", kind: "corrente", archived: false };
const CARTAO = { id: U(31), name: "Nubank", kind: "cartao", archived: false };
const CAT_MERCADO = { id: U(40), name: "Mercado", kind: "despesa" };
const CAT_SALARIO = { id: U(41), name: "Salário", kind: "receita" };
const CAT_LAZER = { id: U(42), name: "Lazer", kind: "despesa" };
const BASE: AlterarLookup = { uid: ME.user_id, me: ME, members: [ME, KAREN], pets: [], today: "2026-11-13" };
const FIN: AlterarLookup = {
  ...BASE,
  accounts: [CONTA, CARTAO].map(({ id, name }) => ({ id, name })),
  categories: [CAT_MERCADO, CAT_SALARIO, CAT_LAZER],
};
const CALS = [
  { id: U(60), summary: "gabriel@gmail.com", primary: true },
  { id: U(61), summary: "Trabalho", primary: false },
];
const AGENDA: AlterarLookup = { ...BASE, calendars: CALS };

function plan(aba: AlterarAba, args: Record<string, unknown>, row: Row | null = null, lk: AlterarLookup = BASE) {
  const a = parseAlterarArgs(aba, args);
  if (!a.ok) return a;
  return planAlteracao(a.value, row, lk);
}
function okPlan(aba: AlterarAba, args: Record<string, unknown>, row: Row | null = null, lk: AlterarLookup = BASE) {
  const r = plan(aba, args, row, lk);
  if (!r.ok) throw new Error(r.erro);
  return r.plan;
}
const erroDe = (r: ReturnType<typeof plan>) => (r.ok ? null : r.erro);

/* ---------- Linhas de exemplo ---------- */
const CONSULTA = { id: U(9), member_id: ME.id, kind: "consulta", specialty: "Cardiologia", doctor: "Dra. Ana", place: "Clínica X", starts_at: "2026-11-20T13:00:00+00:00", status: "agendada", notes: null, return_of: null, agenda_event_id: null };
const MEDICAMENTO = { id: U(10), member_id: ME.id, name: "Losartana", dosage: "50 mg", frequency: "1x ao dia", started_on: "2026-10-01", ended_on: null, active: true, prescribed_by: null, notes: null, reminder_times: ["08:00:00", "20:00:00"] };
const EXAME = { id: U(11), member_id: KAREN.id, name: "Hemograma", exam_date: "2026-10-05", lab: "Lab", requested_by: null, result_summary: "Normal.", file_path: "hh/exams/a.pdf" };
const CARTEIRINHA = { id: U(12), member_id: ME.id, operator: "Unimed", card_number: "0012345", plan_name: null, valid_until: null, notes: null, file_path: "hh/cards/a.pdf" };
const EVENTO = { id: U(13), calendar_ref: U(60), title: "Jantar", description: "Com os pais", location: "Casa", all_day: false, starts_at: "2026-11-20T22:00:00+00:00", ends_at: "2026-11-21T00:00:00+00:00" };
const EVENTO_DIA = { ...EVENTO, id: U(14), title: "Viagem", all_day: true, starts_at: "2026-12-01T03:00:00+00:00", ends_at: "2026-12-04T03:00:00+00:00" };
const LANC = { id: U(15), account_id: CONTA.id, date: "2026-11-10", description: "Mercado do mês", amount: -250.5, category_id: CAT_MERCADO.id, member_id: ME.id, notes: null, source: "manual" };
const CONTA_FIXA = { id: U(16), name: "Luz", amount: 187.9, due_day: 10, category_id: CAT_MERCADO.id, account_id: CONTA.id, active: true, is_home: true };
const AVULSA = { id: U(17), name: "IPVA", amount: 1200, due_date: "2026-12-10", account_id: CONTA.id, category_id: null, paid_on: null, transaction_id: null, paid_auto: false, is_home: false };
const META = { id: U(18), name: "Viagem", target: 5000, account_id: CONTA.id, target_date: "2027-06-01" };

describe("Oli escrita (etapa 3): argumentos e listas fechadas", () => {
  it("abas novas, seções e ações permitidas por seção", () => {
    expect(parseAlterarArgs("saude", { acao: "criar", secao: "dentes" })).toMatchObject({ ok: false, erro: expect.stringContaining("Seção inválida. Use: consultas, exames") });
    expect(parseAlterarArgs("financas", { acao: "criar", secao: "contas_avulsas", nome: "x" })).toMatchObject({ ok: false, erro: expect.stringContaining("Em contas_avulsas dá para: editar, apagar, concluir") });
    expect(parseAlterarArgs("saude", { acao: "criar", secao: "carteirinhas", operadora: "x" })).toMatchObject({ ok: false, erro: expect.stringContaining("Em carteirinhas dá para: editar") });
    expect(parseAlterarArgs("agenda", { acao: "concluir", secao: "eventos", id: U(13) })).toMatchObject({ ok: false });
    expect(parseAlterarArgs("agenda", { acao: "apagar", secao: "eventos", id: "nao-e-uuid" })).toMatchObject({ ok: false, erro: expect.stringContaining("id do item") });
    expect(parseAlterarArgs("agenda", { acao: "apagar", secao: "eventos", id: U(13), titulo: "x" })).toMatchObject({ ok: false });
    expect(parseAlterarArgs("financas", { acao: "editar", secao: "lancamentos", id: U(15), campo_inventado: 1 })).toMatchObject({ ok: false, erro: expect.stringContaining("Campo campo_inventado não existe em lancamentos") });
  });

  it("orçamento não usa id: categoria obrigatória e valor só ao criar/editar", () => {
    expect(parseAlterarArgs("financas", { acao: "criar", secao: "orcamento", id: U(1), categoria: "Mercado", valor: 1 })).toMatchObject({ ok: false, erro: expect.stringContaining("não usa id") });
    expect(parseAlterarArgs("financas", { acao: "criar", secao: "orcamento", valor: 100 })).toEqual({ ok: false, erro: "Diga a categoria do orçamento." });
    expect(parseAlterarArgs("financas", { acao: "criar", secao: "orcamento", categoria: "Mercado" })).toEqual({ ok: false, erro: "Diga o valor do orçamento." });
    expect(parseAlterarArgs("financas", { acao: "apagar", secao: "orcamento", categoria: "Mercado", valor: 1 })).toEqual({ ok: false, erro: "Para apagar o orçamento não mande valor." });
    expect(parseAlterarArgs("financas", { acao: "apagar", secao: "orcamento", categoria: "Mercado" })).toMatchObject({ ok: true });
  });

  it("os campos declarados ao modelo são exatamente os aceitos por aba; persona traz as regras", () => {
    for (const [name, aba] of [["alterar_saude", "saude"], ["alterar_agenda", "agenda"], ["alterar_financas", "financas"]] as const) {
      const tool = ALTERAR_TOOLS.find((t) => t.name === name)!;
      expect(tool, name).toBeTruthy();
      const props = Object.keys(tool.parameters.properties).filter((k) => !["acao", "secao", "id", "frase"].includes(k));
      expect(props.sort()).toEqual(argsDaAba(aba).sort());
      expect(tool.description).toContain("Só PROPÕE");
    }
    expect(OLI_PERSONA).toContain("alterar_saude, alterar_agenda ou alterar_financas");
    expect(OLI_PERSONA).toContain("nunca invente id");
    expect(OLI_PERSONA).toContain("pergunte de novo ao usuário");
    expect(OLI_PERSONA).toContain("NUNCA é editado nem apagado pelo Oli");
    expect(OLI_PERSONA).toContain("apaga também no Google Calendar");
  });
});

describe("Oli escrita (etapa 3): Saúde", () => {
  it("criar exige saber de quem é quando há mais de um adulto (não chuta)", () => {
    const r = plan("saude", { acao: "criar", secao: "exames", nome: "Glicemia" });
    expect(erroDe(r)).toBe("Pergunte para quem é. Opções: Gabriel, Karen.");
    const ok = okPlan("saude", { acao: "criar", secao: "exames", nome: "Glicemia", pessoa: "karen", data: "2026-11-01" });
    expect(ok.raw).toMatchObject({ member_id: KAREN.id, name: "Glicemia", exam_date: "2026-11-01" });
    expect(ok.preview.campos).toContainEqual({ rotulo: "Pessoa", antes: null, depois: "Karen" });
    // "eu" é o usuário; nome desconhecido não vira outra pessoa
    expect(okPlan("saude", { acao: "criar", secao: "exames", nome: "G", pessoa: "eu" }).raw.member_id).toBe(ME.id);
    expect(erroDe(plan("saude", { acao: "criar", secao: "exames", nome: "G", pessoa: "Zé" }))).toContain("Pessoa não encontrada ou ambígua");
    // família com uma pessoa só: é ela
    expect(okPlan("saude", { acao: "criar", secao: "exames", nome: "G" }, null, { ...BASE, members: [ME] }).raw.member_id).toBe(ME.id);
  });

  it("consulta: mesmas regras de validateAppointmentInput; editar mostra só o que muda", () => {
    expect(erroDe(plan("saude", { acao: "criar", secao: "consultas", pessoa: "eu", especialidade: "Dentista" }))).toBe("Informe a data e a hora.");
    const c = okPlan("saude", { acao: "criar", secao: "consultas", pessoa: "eu", especialidade: "Dentista", inicio: "2026-11-25T09:30" });
    expect(c.preview.titulo).toBe("Consulta · Dentista");
    expect(c.preview.campos).toContainEqual({ rotulo: "Data e hora", antes: null, depois: "25/11/2026 09:30" });
    const e = okPlan("saude", { acao: "editar", secao: "consultas", id: U(9), local: "Clínica Y" }, CONSULTA);
    // o horário da linha (UTC) volta ao fuso de São Paulo e não aparece como mudança
    expect(e.preview.campos).toEqual([{ rotulo: "Local", antes: "Clínica X", depois: "Clínica Y" }]);
    expect(e.raw.starts_at).toBe("2026-11-20T10:00");
    expect(erroDe(plan("saude", { acao: "editar", secao: "consultas", id: U(9), local: "Clínica X" }, CONSULTA))).toBe("Nada muda: os valores já são esses.");
    expect(erroDe(plan("saude", { acao: "editar", secao: "consultas", id: U(9), situacao: "talvez" }, CONSULTA))).toContain("Situação inválido");
  });

  it("consulta: concluir muda só a situação (padrão realizada) e recusa o que já é", () => {
    const p = okPlan("saude", { acao: "concluir", secao: "consultas", id: U(9) }, CONSULTA);
    expect(p.raw).toEqual({ status: "realizada" });
    expect(p.preview.campos).toEqual([{ rotulo: "Situação", antes: "Agendada", depois: "Realizada" }]);
    expect(okPlan("saude", { acao: "concluir", secao: "consultas", id: U(9), situacao: "cancelada" }, CONSULTA).raw.status).toBe("cancelada");
    expect(erroDe(plan("saude", { acao: "concluir", secao: "consultas", id: U(9), situacao: "agendada" }, CONSULTA))).toBe("Essa consulta já está agendada.");
  });

  it("medicamento: ativar/desativar exige o ativo explícito e usa a data de término da tela", () => {
    expect(erroDe(plan("saude", { acao: "concluir", secao: "medicamentos", id: U(10) }, MEDICAMENTO))).toBe("Diga se é para encerrar (ativo false) ou voltar a usar (ativo true).");
    const off = okPlan("saude", { acao: "concluir", secao: "medicamentos", id: U(10), ativo: false }, MEDICAMENTO);
    expect(off.raw).toEqual({ active: "false" });
    expect(off.preview.campos).toEqual([
      { rotulo: "Situação", antes: "Em uso", depois: "Encerrado" },
      { rotulo: "Término", antes: null, depois: "13/11/2026" },
    ]);
    expect(erroDe(plan("saude", { acao: "concluir", secao: "medicamentos", id: U(10), ativo: true }, MEDICAMENTO))).toBe("Esse medicamento já está em uso.");
    const on = okPlan("saude", { acao: "concluir", secao: "medicamentos", id: U(10), ativo: true }, { ...MEDICAMENTO, active: false, ended_on: "2026-11-01" });
    expect(on.preview.campos[1]).toEqual({ rotulo: "Término", antes: "01/11/2026", depois: "removido" });
    // início no futuro: o término nunca fica antes do início (regra do banco)
    expect(okPlan("saude", { acao: "concluir", secao: "medicamentos", id: U(10), ativo: false }, { ...MEDICAMENTO, started_on: "2026-12-01" }).preview.campos[1].depois).toBe("01/12/2026");
  });

  it("medicamento: horários dos avisos são validados e a linha volta HH:MM", () => {
    const e = okPlan("saude", { acao: "editar", secao: "medicamentos", id: U(10), dosagem: "100 mg" }, MEDICAMENTO);
    expect(e.raw.reminder_times).toEqual(["08:00", "20:00"]);
    expect(erroDe(plan("saude", { acao: "editar", secao: "medicamentos", id: U(10), horarios: ["8h"] }, MEDICAMENTO))).toBe("Horário de aviso inválido.");
  });

  it("carteirinha: só editar/apagar (criar exige arquivo); exame: acrescentar mantém o resultado", () => {
    expect(okPlan("saude", { acao: "editar", secao: "carteirinhas", id: U(12), plano: "Top" }, CARTEIRINHA).preview.campos).toEqual([{ rotulo: "Plano", antes: null, depois: "Top" }]);
    const a = okPlan("saude", { acao: "acrescentar", secao: "exames", id: U(11), frase: "Revisar em 6 meses." }, EXAME);
    expect(a.raw.result_summary).toBe("Normal.\nRevisar em 6 meses.");
    expect(a.preview.anexo).toEqual({ atual: "Normal.", acrescimo: "Revisar em 6 meses." });
  });

  it("item inexistente (id que não veio do banco) é recusado", () => {
    expect(erroDe(plan("saude", { acao: "apagar", secao: "exames", id: U(99) }, null))).toContain("não encontrad");
  });

  it("consulta na Agenda: apagar/cancelar tira o evento do Google; editar atualiza; sem evento ou Agenda desligada, sem aviso", () => {
    const base = { temEvento: true, agendaLigada: true, statusAntes: "agendada", statusDepois: "agendada" };
    expect(consultaAgendaAviso({ ...base, acao: "apagar" })).toBe("Esta consulta está na Agenda: o evento dela também será apagado do Google Calendar.");
    expect(consultaAgendaAviso({ ...base, acao: "concluir", statusDepois: "cancelada" })).toContain("apagado do Google Calendar");
    expect(consultaAgendaAviso({ ...base, acao: "editar", statusDepois: "cancelada" })).toContain("apagado do Google Calendar");
    expect(consultaAgendaAviso({ ...base, acao: "editar" })).toContain("atualizado");
    expect(consultaAgendaAviso({ ...base, acao: "concluir", statusDepois: "realizada" })).toBeNull(); // fica na Agenda como histórico
    expect(consultaAgendaAviso({ ...base, acao: "apagar", temEvento: false })).toBeNull();
    expect(consultaAgendaAviso({ ...base, acao: "apagar", agendaLigada: false })).toBeNull();
    expect(consultaAgendaAviso({ ...base, acao: "concluir", statusAntes: "cancelada", statusDepois: "cancelada" })).toBeNull();
  });
});

describe("Oli escrita (etapa 3): Agenda", () => {
  it("criar: agenda principal é o padrão; várias sem principal única → pergunta; sem agenda → erro", () => {
    const p = okPlan("agenda", { acao: "criar", secao: "eventos", titulo: "Dentista", inicio: "2026-11-25T09:00" }, null, AGENDA);
    expect(p.raw.calendar_id).toBe(U(60));
    expect(p.preview.campos).toContainEqual({ rotulo: "Agenda", antes: null, depois: "gabriel@gmail.com" });
    expect(okPlan("agenda", { acao: "criar", secao: "eventos", titulo: "Reunião", inicio: "2026-11-25T09:00", agenda: "trabalho" }, null, AGENDA).raw.calendar_id).toBe(U(61));
    const sem = { ...AGENDA, calendars: CALS.map((c) => ({ ...c, primary: false })) };
    expect(erroDe(plan("agenda", { acao: "criar", secao: "eventos", titulo: "x", inicio: "2026-11-25T09:00" }, null, sem))).toBe("Pergunte em qual agenda criar. Opções: gabriel@gmail.com, Trabalho.");
    expect(erroDe(plan("agenda", { acao: "criar", secao: "eventos", titulo: "x", inicio: "2026-11-25T09:00" }, null, { ...BASE, calendars: [] }))).toContain("Nenhuma agenda sua conectada");
    expect(erroDe(plan("agenda", { acao: "criar", secao: "eventos", titulo: "x", inicio: "2026-11-25T09:00", agenda: "Inexistente" }, null, AGENDA))).toContain("não encontrada");
  });

  it("validação do evento é a do formulário (fim antes do início, título, dia inteiro)", () => {
    expect(erroDe(plan("agenda", { acao: "criar", secao: "eventos", titulo: "x", inicio: "2026-11-25T10:00", fim: "2026-11-25T09:00" }, null, AGENDA))).toBe("O fim não pode ser antes do início.");
    expect(erroDe(plan("agenda", { acao: "criar", secao: "eventos", titulo: "x", inicio: "2026-11-25" }, null, AGENDA))).toBe("Início inválido.");
    const d = okPlan("agenda", { acao: "criar", secao: "eventos", titulo: "Feriado", dia_inteiro: true, inicio: "2026-11-27", fim: "2026-11-28" }, null, AGENDA);
    expect(d.preview.campos).toContainEqual({ rotulo: "Início", antes: null, depois: "27/11/2026" });
  });

  it("editar: o evento volta para o formulário no horário de SP; dia inteiro tem fim inclusivo; descrição é preservada", () => {
    const lk = { ...AGENDA, extra: { evento: { editavel: true, dono: "Gabriel" } } };
    const e = okPlan("agenda", { acao: "editar", secao: "eventos", id: U(13), local: "Restaurante" }, EVENTO, lk);
    expect(e.raw).toMatchObject({ title: "Jantar", start: "2026-11-20T19:00", end: "2026-11-20T21:00", description: "Com os pais", calendar_id: U(60) });
    expect(e.preview.campos).toEqual([{ rotulo: "Local", antes: "Casa", depois: "Restaurante" }]);
    const dia = okPlan("agenda", { acao: "editar", secao: "eventos", id: U(14), titulo: "Viagem longa" }, EVENTO_DIA, lk);
    expect(dia.raw).toMatchObject({ all_day: "on", start: "2026-12-01", end: "2026-12-03" });
    expect(erroDe(plan("agenda", { acao: "editar", secao: "eventos", id: U(13), agenda: "Trabalho" }, EVENTO, lk))).toContain("Agenda não muda na edição");
  });

  it("formulário da tela: dia inteiro usa start_date/end_date; com horário usa start/end", async () => {
    const { planToFormEntries } = await import("@/lib/oli/alterar");
    const lk = { ...AGENDA, extra: { evento: { editavel: true, dono: "Gabriel" } } };
    const e = planToFormEntries(okPlan("agenda", { acao: "editar", secao: "eventos", id: U(14), titulo: "Viagem longa" }, EVENTO_DIA, lk));
    expect(e).toContainEqual(["id", U(14)]);
    expect(e).toContainEqual(["all_day", "on"]);
    expect(e).toContainEqual(["start_date", "2026-12-01"]);
    expect(e).toContainEqual(["end_date", "2026-12-03"]);
    expect(e.some(([k]) => k === "start")).toBe(false);
    const t = planToFormEntries(okPlan("agenda", { acao: "editar", secao: "eventos", id: U(13), local: "X" }, EVENTO, lk));
    expect(t).toContainEqual(["start", "2026-11-20T19:00"]);
    expect(t.some(([k]) => k === "all_day")).toBe(false);
  });

  it("evento de outra pessoa ou sem conferência do dono: recusa editar e apagar", () => {
    const outro = { ...AGENDA, extra: { evento: { editavel: false, dono: "Karen" } } };
    for (const acao of ["editar", "apagar"]) {
      const args = acao === "editar" ? { acao, secao: "eventos", id: U(13), local: "x" } : { acao, secao: "eventos", id: U(13) };
      expect(erroDe(plan("agenda", args, EVENTO, outro))).toBe("Esse evento está na agenda de Karen: só quem é dono da agenda pode alterar ou apagar.");
      expect(erroDe(plan("agenda", args, EVENTO, AGENDA))).toContain("Não consegui conferir de quem é o evento");
    }
  });

  it("aviso de apagar: diz que some do Google Calendar de verdade; avisa consulta ligada", () => {
    expect(eventoApagarAviso("gabriel@gmail.com", 0)).toBe("Este evento será apagado de verdade da agenda “gabriel@gmail.com” do Google Calendar: ele some do Google, não só do app.");
    expect(eventoApagarAviso(null, 1)).toContain("é o evento de uma consulta de Saúde");
    expect(eventoApagarAviso(null, 2)).toContain("2 consultas");
  });
});

describe("Oli escrita (etapa 3): Finanças, lançamentos", () => {
  it("lançamento do Open Finance NUNCA é editado, apagado nem recebe frase", () => {
    const pluggy = { ...LANC, source: "openfinance" };
    for (const args of [
      { acao: "editar", secao: "lancamentos", id: U(15), descricao: "Outro nome" },
      { acao: "apagar", secao: "lancamentos", id: U(15) },
      { acao: "acrescentar", secao: "lancamentos", id: U(15), frase: "x" },
    ]) {
      expect(erroDe(plan("financas", args, pluggy, FIN)), JSON.stringify(args)).toBe(OPEN_FINANCE_RECUSA);
    }
    // origem desconhecida (ou ausente) também fica de fora: só as origens que as telas editam
    expect(erroDe(plan("financas", { acao: "apagar", secao: "lancamentos", id: U(15) }, { ...LANC, source: "pluggy2" }, FIN))).toBe(ORIGEM_DESCONHECIDA);
    expect(erroDe(plan("financas", { acao: "apagar", secao: "lancamentos", id: U(15) }, { ...LANC, source: undefined }, FIN))).toBe(ORIGEM_DESCONHECIDA);
    // as origens editáveis passam
    for (const source of ["manual", "ofx", "csv", "documento"]) expect(plan("financas", { acao: "apagar", secao: "lancamentos", id: U(15) }, { ...LANC, source }, FIN).ok).toBe(true);
  });

  it("criar: conta e categoria por nome, valor positivo + tipo define o sinal; ambíguo ou ausente pergunta", () => {
    const p = okPlan("financas", { acao: "criar", secao: "lancamentos", descricao: "Padaria", valor: 12.5, tipo: "saida", conta: "itaú", categoria: "mercado", data: "2026-11-12" }, null, FIN);
    expect(p.raw).toMatchObject({ description: "Padaria", amount: "12,50", direction: "saida", account_id: CONTA.id, category_id: CAT_MERCADO.id, date: "2026-11-12", member_id: ME.id });
    expect(p.preview.campos).toContainEqual({ rotulo: "Valor", antes: null, depois: "R$\u00a012,50" });
    expect(erroDe(plan("financas", { acao: "criar", secao: "lancamentos", descricao: "x", valor: 1 }, null, FIN))).toBe("Pergunte em qual conta é. Opções: Conta Itaú, Nubank.");
    expect(erroDe(plan("financas", { acao: "criar", secao: "lancamentos", descricao: "x", valor: 1, conta: "banco" }, null, FIN))).toContain("Conta não encontrada(o) ou ambígua(o)");
    expect(erroDe(plan("financas", { acao: "criar", secao: "lancamentos", descricao: "x", valor: -5, conta: "Itaú" }, null, FIN))).toBe("Valor inválido.");
    expect(erroDe(plan("financas", { acao: "criar", secao: "lancamentos", descricao: "x", valor: 5, conta: "Itaú", data: "2026-02-31" }, null, FIN))).toBe("Data inválida.");
    // uma só conta ativa: é o padrão
    expect(okPlan("financas", { acao: "criar", secao: "lancamentos", descricao: "x", valor: 5 }, null, { ...FIN, accounts: [FIN.accounts![0]] }).raw.account_id).toBe(CONTA.id);
  });

  it("categoria de receita só com Entrada e de despesa só com Saída (como o formulário)", () => {
    expect(erroDe(plan("financas", { acao: "criar", secao: "lancamentos", descricao: "x", valor: 5, conta: "Itaú", categoria: "Salário" }, null, FIN))).toBe("A categoria Salário é de receita: o lançamento tem que ser uma Entrada.");
    expect(okPlan("financas", { acao: "criar", secao: "lancamentos", descricao: "Pix", valor: 5, conta: "Itaú", categoria: "Salário", tipo: "entrada" }, null, FIN).raw.direction).toBe("entrada");
    expect(erroDe(plan("financas", { acao: "criar", secao: "lancamentos", descricao: "x", valor: 5, conta: "Itaú", categoria: "Mercado", tipo: "entrada" }, null, FIN))).toContain("é de despesa");
  });

  it("editar: sinal vem da linha (saída fica saída); só o valor muda; trocar tipo é explícito", () => {
    const e = okPlan("financas", { acao: "editar", secao: "lancamentos", id: U(15), valor: 300 }, LANC, FIN);
    expect(e.raw).toMatchObject({ amount: "300,00", direction: "saida" });
    expect(e.preview.campos).toEqual([{ rotulo: "Valor", antes: "R$\u00a0250,50", depois: "R$\u00a0300,00" }]);
    const entrada = okPlan("financas", { acao: "editar", secao: "lancamentos", id: U(15), descricao: "Reembolso" }, { ...LANC, amount: 80, category_id: null }, FIN);
    expect(entrada.raw.direction).toBe("entrada");
  });

  it("acrescentar nas observações mantém o texto e não passa de 500 letras", () => {
    const a = okPlan("financas", { acao: "acrescentar", secao: "lancamentos", id: U(15), frase: "Compra grande." }, { ...LANC, notes: "Cartão do pai." }, FIN);
    expect(a.raw.notes).toBe("Cartão do pai.\nCompra grande.");
    expect(erroDe(plan("financas", { acao: "acrescentar", secao: "lancamentos", id: U(15), frase: "x".repeat(400) }, { ...LANC, notes: "y".repeat(200) }, FIN))).toBe("Observações muito longas (máximo 500).");
  });

  it("apagar mostra o lançamento; texto do alerta cobre saldo, relatório e baixa de conta ligada", () => {
    const p = okPlan("financas", { acao: "apagar", secao: "lancamentos", id: U(15) }, LANC, FIN);
    expect(p.preview.campos).toContainEqual({ rotulo: "Valor", antes: "R$\u00a0250,50", depois: null });
    expect(lancamentoApagarAviso({ valor: -250.5, conta: "Conta Itaú", data: "2026-11-10" }, { fixas: 0, avulsas: 0 })).toBe(
      "Apaga o lançamento de R$\u00a0250,50 (10/11/2026): o saldo de Conta Itaú e os relatórios de Novembro de 2026 passam a ser calculados sem ele.",
    );
    const ligado = lancamentoApagarAviso({ valor: -250.5, conta: "Conta Itaú", data: "2026-11-10" }, { fixas: 1, avulsas: 2 });
    expect(ligado).toContain("Ele deu baixa em 1 conta fixa e 2 contas avulsas: continuam marcadas como pagas, mas sem ligação com o extrato.");
  });
});

describe("Oli escrita (etapa 3): Finanças, contas, metas e orçamento", () => {
  it("conta fixa: mesmas regras de saveBill; criar/editar/apagar", () => {
    const c = okPlan("financas", { acao: "criar", secao: "contas_fixas", nome: "Internet", valor: 99.9, dia_vencimento: 5, conta: "Itaú", da_casa: true }, null, FIN);
    expect(c.raw).toMatchObject({ name: "Internet", amount: "99,90", due_day: "5", account_id: CONTA.id, is_home: "on" });
    expect(erroDe(plan("financas", { acao: "criar", secao: "contas_fixas", nome: "x", valor: 10, dia_vencimento: 32 }, null, FIN))).toBe("Dia de vencimento entre 1 e 31.");
    expect(erroDe(plan("financas", { acao: "criar", secao: "contas_fixas", nome: "x", valor: 0, dia_vencimento: 5 }, null, FIN))).toBe("Valor inválido.");
    const e = okPlan("financas", { acao: "editar", secao: "contas_fixas", id: U(16), valor: 200 }, CONTA_FIXA, FIN);
    expect(e.raw).toMatchObject({ inactive: "", is_home: "on" }); // não perde "da casa" nem reativa/desativa sem pedir
    expect(e.preview.campos).toEqual([{ rotulo: "Valor", antes: "R$\u00a0187,90", depois: "R$\u00a0200,00" }]);
    expect(okPlan("financas", { acao: "editar", secao: "contas_fixas", id: U(16), inativa: true }, CONTA_FIXA, FIN).raw.inactive).toBe("on");
    expect(contaFixaApagarAviso(0)).toBeNull();
    expect(contaFixaApagarAviso(1)).toBe("O pagamento registrado desta conta também é apagado. Os lançamentos do extrato ficam.");
    expect(contaFixaApagarAviso(3)).toContain("Os 3 pagamentos registrados");
  });

  it("conta avulsa: não cria; edita com validateOneOffInput", () => {
    expect(erroDe(plan("financas", { acao: "editar", secao: "contas_avulsas", id: U(17), valor: -1 }, AVULSA, FIN))).toBe("Valor inválido.");
    const e = okPlan("financas", { acao: "editar", secao: "contas_avulsas", id: U(17), vencimento: "2026-12-20" }, AVULSA, FIN);
    expect(e.preview.campos).toEqual([{ rotulo: "Vencimento", antes: "10/12/2026", depois: "20/12/2026" }]);
  });

  it("meta: conta obrigatória (pergunta quando há mais de uma); valor e prazo validados", () => {
    expect(erroDe(plan("financas", { acao: "criar", secao: "metas", nome: "Carro", valor: 30000 }, null, FIN))).toContain("Pergunte em qual conta o dinheiro da meta fica guardado");
    const m = okPlan("financas", { acao: "criar", secao: "metas", nome: "Carro", valor: 30000, conta: "Nubank", prazo: "2027-12-01" }, null, FIN);
    expect(m.raw).toMatchObject({ name: "Carro", target: "30000,00", account_id: CARTAO.id, target_date: "2027-12-01" });
    expect(erroDe(plan("financas", { acao: "editar", secao: "metas", id: U(18), prazo: "2027-13-01" }, META, FIN))).toBe("Data inválida.");
  });

  it("orçamento: só despesa; todos os meses ou um mês; criar x editar conforme a linha existente", () => {
    const criar = okPlan("financas", { acao: "criar", secao: "orcamento", categoria: "Mercado", valor: 1500 }, null, FIN);
    expect(criar.raw).toEqual({ category_id: CAT_MERCADO.id, scope: "todos", month: "2026-11", amount: "1500,00" });
    expect(criar.preview.titulo).toBe("Mercado");
    expect(criar.preview.campos.map((c) => c.rotulo)).toEqual(["Categoria", "Vale para", "Valor"]); // mês some quando vale para todos
    const mes = okPlan("financas", { acao: "criar", secao: "orcamento", categoria: "Mercado", valor: 900, escopo: "mes", mes: "2026-12" }, null, FIN);
    expect(mes.raw).toMatchObject({ scope: "mes", month: "2026-12" });
    expect(mes.preview.campos.map((c) => c.rotulo)).toContain("Mês");
    expect(erroDe(plan("financas", { acao: "criar", secao: "orcamento", categoria: "Salário", valor: 5 }, null, FIN))).toBe("Orçamento só vale para categorias de despesa.");
    expect(erroDe(plan("financas", { acao: "criar", secao: "orcamento", categoria: "Mercado", valor: 1, escopo: "mes", mes: "2026-13" }, null, FIN))).toBe("Mês inválido. Use AAAA-MM.");
    const existente = { id: U(19), category_id: CAT_MERCADO.id, month: null, amount: 1500 };
    expect(erroDe(plan("financas", { acao: "criar", secao: "orcamento", categoria: "Mercado", valor: 1600 }, existente, FIN))).toBe("Já existe orçamento para essa categoria: use editar.");
    expect(erroDe(plan("financas", { acao: "editar", secao: "orcamento", categoria: "Mercado", valor: 1600 }, null, FIN))).toBe("Orçamento não encontrada(o). Para criar, use acao criar.");
    const ed = okPlan("financas", { acao: "editar", secao: "orcamento", categoria: "Mercado", valor: 1600 }, existente, FIN);
    expect(ed.preview.campos).toEqual([{ rotulo: "Valor", antes: "R$\u00a01.500,00", depois: "R$\u00a01.600,00" }]);
    expect(okPlan("financas", { acao: "apagar", secao: "orcamento", categoria: "Mercado" }, existente, FIN).preview.campos).toContainEqual({ rotulo: "Valor", antes: "R$\u00a01.500,00", depois: null });
  });
});

describe("Oli escrita (etapa 3): marcar paga e desfazer pagamento", () => {
  const SEM_USO = { fixed: [], oneOff: [] };
  const lkFixa = (pag: Partial<NonNullable<NonNullable<AlterarLookup["extra"]>["pag"]>> = {}): AlterarLookup => ({
    ...FIN,
    extra: { pag: { mes: "2026-11", pagamento: null, tx: null, usos: SEM_USO, ...pag } },
  });
  const TX = { id: U(70), date: "2026-11-09", amount: -187.9, description: "ENEL" };

  it("marcar paga sem lançamento: data padrão hoje e valor da conta; com lançamento: leva o id", () => {
    const p = okPlan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16) }, CONTA_FIXA, lkFixa());
    expect(p.raw).toEqual({ desfazer: "false", id: U(16), month: "2026-11", transaction_id: "sem", paid_on: "2026-11-13", amount: "187,90" });
    expect(p.preview.campos).toEqual([
      { rotulo: "Mês", antes: null, depois: "Novembro de 2026" },
      { rotulo: "Situação", antes: "Em aberto", depois: "Paga" },
      { rotulo: "Pago em", antes: null, depois: "13/11/2026" },
      { rotulo: "Valor pago", antes: null, depois: "R$\u00a0187,90" },
    ]);
    expect(p.preview.aviso).toBeNull();
    const l = okPlan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), lancamento: U(70) }, CONTA_FIXA, lkFixa({ tx: TX }));
    expect(l.raw).toMatchObject({ transaction_id: U(70), paid_on: "2026-11-09" });
    expect(l.preview.campos).toContainEqual({ rotulo: "Lançamento", antes: null, depois: "ENEL · R$\u00a0187,90 · 09/11/2026" });
  });

  it("já paga: recusa e manda desfazer antes; mês inválido e valor inválido recusam", () => {
    const paga = { id: U(80), auto: false, paid_on: "2026-11-05", amount: 187.9 };
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16) }, CONTA_FIXA, lkFixa({ pagamento: paga })))).toBe("Luz já está paga em Novembro de 2026. Para trocar, desfaça o pagamento antes.");
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), mes: "2026-13" }, CONTA_FIXA, lkFixa()))).toBe("Mês inválido. Use AAAA-MM.");
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), valor: -3 }, CONTA_FIXA, lkFixa()))).toBe("Valor pago inválido.");
  });

  it("sem a conferência do servidor (extra ausente ou de outro mês) recusa em vez de seguir", () => {
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16) }, CONTA_FIXA, FIN))).toContain("Não consegui conferir o pagamento");
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), mes: "2026-10" }, CONTA_FIXA, lkFixa()))).toContain("Não consegui conferir o pagamento");
  });

  it("lançamento escolhido: precisa existir, ser de saída e não pagar duas contas (fixa x avulsa)", () => {
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), lancamento: U(70) }, CONTA_FIXA, lkFixa()))).toBe("Lançamento não encontrado nesta família.");
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), lancamento: "x" }, CONTA_FIXA, lkFixa()))).toContain("Lançamento inválido");
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), lancamento: U(70) }, CONTA_FIXA, lkFixa({ tx: { ...TX, amount: 50 } })))).toBe("Escolha um lançamento de saída desta família.");
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), lancamento: U(70) }, CONTA_FIXA, lkFixa({ tx: TX, usos: { fixed: [], oneOff: [{ id: U(17) }] } })))).toBe(
      "Este lançamento já pagou uma conta avulsa. Desfaça aquele pagamento antes.",
    );
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), lancamento: U(70) }, CONTA_FIXA, lkFixa({ tx: TX, usos: { fixed: [{ bill_id: U(99), month: "2026-11" }], oneOff: [] } })))).toBe("Este lançamento já pagou outra conta fixa.");
    // avulsa: um lançamento que já pagou conta fixa não paga avulsa
    const lkAv: AlterarLookup = { ...FIN, extra: { pag: { mes: null, pagamento: null, tx: TX, usos: { fixed: [{ bill_id: U(16), month: "2026-11" }], oneOff: [] } } } };
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_avulsas", id: U(17), lancamento: U(70) }, AVULSA, lkAv))).toBe("Este lançamento já pagou uma conta fixa. Desfaça aquele pagamento antes.");
  });

  it("desfazer pagamento: exige pagamento; alerta vermelho explica o efeito (e a baixa automática)", () => {
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), pago: false }, CONTA_FIXA, lkFixa()))).toBe("Luz não tem pagamento registrado em Novembro de 2026.");
    const paga = { id: U(80), auto: true, paid_on: "2026-11-05", amount: 187.9 };
    const p = okPlan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), pago: false }, CONTA_FIXA, lkFixa({ pagamento: paga }));
    expect(p.raw).toEqual({ desfazer: "true", id: U(80), month: "2026-11", auto: "true" });
    expect(p.preview.campos).toContainEqual({ rotulo: "Situação", antes: "Paga", depois: "Em aberto" });
    expect(p.preview.aviso).toBe(desfazerAviso("Luz", "Novembro de 2026", true));
    expect(p.preview.aviso).toContain("a conta volta a ficar em aberto");
    expect(p.preview.aviso).toContain("não refaz essa baixa sozinho");
    expect(desfazerAviso("Luz", "Novembro de 2026", false)).not.toContain("automática");
  });

  it("avulsa: marcar paga, já paga e desfazer", () => {
    const lk: AlterarLookup = { ...FIN, extra: { pag: { mes: null, pagamento: null, tx: null, usos: SEM_USO } } };
    const p = okPlan("financas", { acao: "concluir", secao: "contas_avulsas", id: U(17), data: "2026-12-09" }, AVULSA, lk);
    expect(p.raw).toEqual({ desfazer: "false", id: U(17), month: "", transaction_id: "sem", paid_on: "2026-12-09", amount: "1200,00" });
    const paga = { ...AVULSA, paid_on: "2026-12-09", paid_auto: false };
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_avulsas", id: U(17) }, paga, lk))).toContain("IPVA já está paga");
    const u = okPlan("financas", { acao: "concluir", secao: "contas_avulsas", id: U(17), pago: false }, paga, lk);
    expect(u.raw).toMatchObject({ desfazer: "true", id: U(17) });
    expect(u.preview.aviso).toContain("a conta volta a ficar em aberto");
    expect(erroDe(plan("financas", { acao: "concluir", secao: "contas_avulsas", id: U(17), pago: false }, AVULSA, lk))).toContain("não tem pagamento registrado");
  });

  it("o painel muda se o item mudou entre propor e Confirmar (ITEM_MUDOU)", () => {
    const args = { acao: "editar", secao: "lancamentos", id: U(15), valor: 300 };
    const mostrado = okPlan("financas", args, LANC, FIN).preview;
    expect(previewFingerprint(okPlan("financas", args, LANC, FIN).preview)).toBe(previewFingerprint(mostrado));
    expect(previewFingerprint(okPlan("financas", args, { ...LANC, amount: -260 }, FIN).preview)).not.toBe(previewFingerprint(mostrado));
  });
});

/* ---------- Servidor: preparar e executar ---------- */
const ctx = {
  household: { id: U(900) },
  user: { id: ME.user_id },
  me: ME,
  members: [ME, KAREN],
} as never;

async function prep(aba: AlterarAba, args: Record<string, unknown>) {
  const { prepararAlteracao } = await import("@/lib/oli/alterar-server");
  const a = parseAlterarArgs(aba, args);
  if (!a.ok) throw new Error(a.erro);
  return prepararAlteracao(ctx, a.value);
}
const FALHOU = { ok: false, erro: "Não consegui conferir o item agora. Nada foi alterado: tente de novo." };

describe("Oli escrita (etapa 3): servidor, recusas por consulta que falha", () => {
  beforeEach(() => {
    calls.list = [];
    calls.redirect = false;
    calls.saveResult = { ok: true };
    db.rows = {};
    db.counts = {};
    db.errors = {};
    db.removed = new Set();
    fx.agendaOn = true;
    fx.writable = CALS;
    fx.calendars = [{ id: U(60), account_ref: U(200) }];
    fx.accounts = [{ id: U(200), member_id: ME.id }];
    fx.fin = { accounts: [CONTA, CARTAO], categories: [CAT_MERCADO, CAT_SALARIO, CAT_LAZER] };
  });

  it("Open Finance: a proposta é recusada pelo servidor (e o Confirmar, que refaz o plano, também)", async () => {
    db.rows.fin_transactions = { ...LANC, source: "openfinance" };
    const r = await prep("financas", { acao: "apagar", secao: "lancamentos", id: U(15) });
    expect(r).toEqual({ ok: false, erro: OPEN_FINANCE_RECUSA });
    expect(await prep("financas", { acao: "editar", secao: "lancamentos", id: U(15), descricao: "x" })).toEqual({ ok: false, erro: OPEN_FINANCE_RECUSA });
    db.rows.fin_transactions = { ...LANC, source: "manual" };
    expect(await prep("financas", { acao: "apagar", secao: "lancamentos", id: U(15) })).toMatchObject({ ok: true });
  });

  it("apagar lançamento: alerta sempre; conta as baixas; erro ou count ausente RECUSA (não segue sem o aviso)", async () => {
    db.rows.fin_transactions = LANC;
    db.counts.fin_bill_payments = 1;
    db.counts.fin_one_off_bills = 0;
    const ok = await prep("financas", { acao: "apagar", secao: "lancamentos", id: U(15) });
    if (!ok.ok) throw new Error(ok.erro);
    expect(ok.plan.preview.aviso).toContain("Apaga o lançamento de R$\u00a0250,50");
    expect(ok.plan.preview.aviso).toContain("Ele deu baixa em 1 conta fixa");
    db.errors.fin_bill_payments = true;
    expect(await prep("financas", { acao: "apagar", secao: "lancamentos", id: U(15) })).toEqual(FALHOU);
    db.errors.fin_bill_payments = false;
    db.counts.fin_one_off_bills = null;
    expect(await prep("financas", { acao: "apagar", secao: "lancamentos", id: U(15) })).toEqual(FALHOU);
  });

  it("apagar evento: aviso do Google em destaque; falha na contagem de consultas ligadas recusa", async () => {
    db.rows.cal_events = EVENTO;
    db.counts.health_appointments = 0;
    const ok = await prep("agenda", { acao: "apagar", secao: "eventos", id: U(13) });
    if (!ok.ok) throw new Error(ok.erro);
    expect(ok.plan.preview.aviso).toBe("Este evento será apagado de verdade da agenda “gabriel@gmail.com” do Google Calendar: ele some do Google, não só do app.");
    db.counts.health_appointments = 1;
    const lig = await prep("agenda", { acao: "apagar", secao: "eventos", id: U(13) });
    expect(lig.ok && lig.plan.preview.aviso).toContain("evento de uma consulta de Saúde");
    db.errors.health_appointments = true;
    expect(await prep("agenda", { acao: "apagar", secao: "eventos", id: U(13) })).toEqual(FALHOU);
    db.errors.health_appointments = false;
    db.counts.health_appointments = null;
    expect(await prep("agenda", { acao: "apagar", secao: "eventos", id: U(13) })).toEqual(FALHOU);
  });

  it("agenda: família sem Agenda liberada e evento de outra pessoa são recusados", async () => {
    db.rows.cal_events = EVENTO;
    db.counts.health_appointments = 0;
    fx.agendaOn = false;
    expect(await prep("agenda", { acao: "apagar", secao: "eventos", id: U(13) })).toEqual({ ok: false, erro: "A Agenda não está liberada para esta família." });
    fx.agendaOn = true;
    fx.writable = []; // a agenda do evento não é minha
    fx.calendars = [{ id: U(60), account_ref: U(201) }];
    fx.accounts = [{ id: U(201), member_id: KAREN.id }];
    expect(await prep("agenda", { acao: "editar", secao: "eventos", id: U(13), local: "x" })).toEqual({
      ok: false,
      erro: "Esse evento está na agenda de Karen: só quem é dono da agenda pode alterar ou apagar.",
    });
  });

  it("apagar conta fixa: conta os pagamentos; falha recusa", async () => {
    db.rows.fin_bills = CONTA_FIXA;
    db.counts.fin_bill_payments = 2;
    const ok = await prep("financas", { acao: "apagar", secao: "contas_fixas", id: U(16) });
    expect(ok.ok && ok.plan.preview.aviso).toContain("Os 2 pagamentos registrados");
    db.errors.fin_bill_payments = true;
    expect(await prep("financas", { acao: "apagar", secao: "contas_fixas", id: U(16) })).toEqual(FALHOU);
  });

  it("consulta: aviso da Agenda só com evento ligado e Agenda ligada; apagar exame leva o aviso do arquivo", async () => {
    db.rows.health_appointments = { ...CONSULTA, agenda_event_id: U(13) };
    const ok = await prep("saude", { acao: "apagar", secao: "consultas", id: U(9) });
    expect(ok.ok && ok.plan.preview.aviso).toBe("Esta consulta está na Agenda: o evento dela também será apagado do Google Calendar.");
    fx.agendaOn = false;
    const off = await prep("saude", { acao: "apagar", secao: "consultas", id: U(9) });
    expect(off.ok && off.plan.preview.aviso).toBeNull();
    db.rows.health_exams = EXAME;
    const ex = await prep("saude", { acao: "apagar", secao: "exames", id: U(11) });
    expect(ex.ok && ex.plan.preview.aviso).toBe("O arquivo guardado também será apagado.");
  });

  it("pagamento: falha ao ler o pagamento do mês recusa; ao ler o lançamento escolhido também", async () => {
    db.rows.fin_bills = CONTA_FIXA;
    db.rows.fin_bill_payments = null;
    expect(await prep("financas", { acao: "concluir", secao: "contas_fixas", id: U(16) })).toMatchObject({ ok: true });
    db.errors.fin_bill_payments = true;
    expect(await prep("financas", { acao: "concluir", secao: "contas_fixas", id: U(16) })).toEqual(FALHOU);
    db.errors.fin_bill_payments = false;
    db.rows.fin_transactions = null;
    db.errors.fin_transactions = true;
    expect(await prep("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), lancamento: U(70) })).toEqual(FALHOU);
  });

  it("orçamento: acha a linha pela categoria; categoria desconhecida pede opções", async () => {
    db.rows.fin_budgets = { id: U(19), category_id: CAT_MERCADO.id, month: null, amount: 1500 };
    const r = await prep("financas", { acao: "editar", secao: "orcamento", categoria: "Mercado", valor: 1700 });
    expect(r.ok && r.plan.preview.campos).toEqual([{ rotulo: "Valor", antes: "R$\u00a01.500,00", depois: "R$\u00a01.700,00" }]);
    expect(await prep("financas", { acao: "criar", secao: "orcamento", categoria: "Mercado", valor: 1 })).toMatchObject({ ok: false, erro: expect.stringContaining("Já existe") });
    expect(await prep("financas", { acao: "editar", secao: "orcamento", categoria: "Salário", valor: 1 })).toEqual({ ok: false, erro: "Categoria de despesa não encontrada ou ambígua. Opções: Mercado, Lazer." });
    db.errors.fin_budgets = true;
    expect(await prep("financas", { acao: "editar", secao: "orcamento", categoria: "Mercado", valor: 1700 })).toEqual({ ok: false, erro: "Não consegui ler o orçamento agora." });
  });
});

describe("Oli escrita (etapa 3): servidor, gravação pelas actions das telas", () => {
  beforeEach(() => {
    calls.list = [];
    calls.redirect = false;
    calls.saveResult = { ok: true };
    db.rows = {};
    db.counts = {};
    db.errors = {};
    db.removed = new Set();
    fx.agendaOn = true;
    fx.writable = CALS;
    fx.calendars = [{ id: U(60), account_ref: U(200) }];
    fx.accounts = [{ id: U(200), member_id: ME.id }];
    fx.fin = { accounts: [CONTA, CARTAO], categories: [CAT_MERCADO, CAT_SALARIO, CAT_LAZER] };
  });
  const exec = async (aba: AlterarAba, args: Record<string, unknown>) => {
    const { executarAlteracao } = await import("@/lib/oli/alterar-server");
    const p = await prep(aba, args);
    if (!p.ok) throw new Error(p.erro);
    return executarAlteracao(p);
  };

  it("Saúde: cada seção chama a action certa; consulta concluir e medicamento usam as actions de situação", async () => {
    db.rows.health_appointments = CONSULTA;
    db.rows.health_medications = MEDICAMENTO;
    db.rows.health_exams = EXAME;
    expect(await exec("saude", { acao: "concluir", secao: "consultas", id: U(9), situacao: "cancelada" })).toEqual({ ok: true });
    expect(await exec("saude", { acao: "concluir", secao: "medicamentos", id: U(10), ativo: false })).toEqual({ ok: true });
    expect(await exec("saude", { acao: "apagar", secao: "exames", id: U(11) })).toEqual({ ok: true });
    expect(await exec("saude", { acao: "criar", secao: "vacinas", pessoa: "karen", nome: "Gripe", data: "2026-11-01" })).toEqual({ ok: true });
    expect(await exec("saude", { acao: "editar", secao: "medicamentos", id: U(10), dosagem: "100 mg" })).toEqual({ ok: true });
    expect(calls.list.map((c) => c.fn)).toEqual(["setAppointmentStatus", "setMedicationActive", "deleteExam", "saveVaccine", "saveMedication"]);
    expect(calls.list[0].arg).toEqual([U(9), "cancelada"]);
    expect(calls.list[1].arg).toEqual([U(10), false]);
    expect(calls.list[3].arg).toEqual([["member_id", KAREN.id], ["name", "Gripe"], ["applied_on", "2026-11-01"]]);
    // horários voltam como campos repetidos
    expect((calls.list[4].arg as [string, string][]).filter(([k]) => k === "reminder_times")).toEqual([["reminder_times", "08:00"], ["reminder_times", "20:00"]]);
  });

  it("Agenda: criar e editar mandam o formulário da tela; apagar usa deleteAgendaEvent", async () => {
    db.rows.cal_events = EVENTO;
    db.counts.health_appointments = 0;
    await exec("agenda", { acao: "criar", secao: "eventos", titulo: "Dentista", inicio: "2026-11-25T09:00" });
    await exec("agenda", { acao: "editar", secao: "eventos", id: U(13), local: "Restaurante" });
    await exec("agenda", { acao: "apagar", secao: "eventos", id: U(13) });
    expect(calls.list[0]).toEqual({
      fn: "saveEvent",
      arg: [["title", "Dentista"], ["start", "2026-11-25T09:00"], ["end", ""], ["location", ""], ["description", ""], ["calendar_id", U(60)]],
    });
    expect((calls.list[1].arg as [string, string][])[0]).toEqual(["id", U(13)]);
    expect(calls.list[2]).toEqual({ fn: "deleteAgendaEvent", arg: U(13) });
  });

  it("redirect() de sucesso das actions de Finanças vale como gravado (e não vaza da função)", async () => {
    calls.redirect = true;
    db.rows.fin_transactions = LANC;
    db.counts.fin_bill_payments = 0;
    db.counts.fin_one_off_bills = 0;
    expect(await exec("financas", { acao: "editar", secao: "lancamentos", id: U(15), valor: 300 })).toEqual({ ok: true });
    expect(await exec("financas", { acao: "criar", secao: "lancamentos", descricao: "Pão", valor: 5, conta: "Itaú" })).toEqual({ ok: true });
    expect(await exec("financas", { acao: "criar", secao: "metas", nome: "Carro", valor: 100, conta: "Itaú" })).toEqual({ ok: true });
    expect(calls.list.map((c) => c.fn)).toEqual(["saveTransaction", "saveTransaction", "saveGoal"]);
    expect(calls.list[0].arg).toEqual([["id", U(15)], ["description", "Mercado do mês"], ["amount", "300,00"], ["direction", "saida"], ["date", "2026-11-10"], ["account_id", CONTA.id], ["category_id", CAT_MERCADO.id], ["member_id", ME.id], ["notes", ""]]);
  });

  it("erro devolvido pela action (sem redirect) volta como erro, nunca como gravado", async () => {
    calls.saveResult = { error: "Não foi possível salvar. Confira conta e categoria." };
    db.rows.fin_transactions = LANC;
    expect(await exec("financas", { acao: "editar", secao: "lancamentos", id: U(15), valor: 300 })).toEqual({ ok: false, erro: "Não foi possível salvar. Confira conta e categoria." });
  });

  it("apagar lançamento: confere no banco que a linha sumiu (deleteTransaction não diz se apagou)", async () => {
    calls.redirect = true;
    db.rows.fin_transactions = LANC;
    db.counts.fin_bill_payments = 0;
    db.counts.fin_one_off_bills = 0;
    // a action redireciona mas a linha continua: não pode virar "Apagado"
    expect(await exec("financas", { acao: "apagar", secao: "lancamentos", id: U(15) })).toEqual({ ok: false, erro: "Não foi possível apagar." });
    // agora a linha sumiu depois da action
    const { executarAlteracao } = await import("@/lib/oli/alterar-server");
    const p = await prep("financas", { acao: "apagar", secao: "lancamentos", id: U(15) });
    if (!p.ok) throw new Error(p.erro);
    db.removed.add("fin_transactions");
    expect(await executarAlteracao(p)).toEqual({ ok: true });
    expect(calls.list.map((c) => c.fn)).toEqual(["deleteTransaction", "deleteTransaction"]);
  });

  it("marcar paga e desfazer pagamento usam payBill/undoPayment (fixa) e payOneOff/undoOneOffPayment (avulsa)", async () => {
    calls.redirect = true;
    db.rows.fin_bills = CONTA_FIXA;
    db.rows.fin_bill_payments = null;
    expect(await exec("financas", { acao: "concluir", secao: "contas_fixas", id: U(16) })).toEqual({ ok: true });
    expect(calls.list[0]).toEqual({ fn: "payBill", arg: [["bill_id", U(16)], ["month", "2026-11"], ["transaction_id", "sem"], ["paid_on", "2026-11-13"], ["amount", "187,90"]] });
    // desfazer: pagamento existe; a action apaga e a linha some
    db.rows.fin_bill_payments = { id: U(80), auto: false, paid_on: "2026-11-05", amount: 187.9 };
    const { executarAlteracao } = await import("@/lib/oli/alterar-server");
    const p = await prep("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), pago: false });
    if (!p.ok) throw new Error(p.erro);
    expect(await executarAlteracao(p)).toEqual({ ok: false, erro: "Não foi possível desfazer o pagamento." }); // linha continua: não vale
    db.removed.add("fin_bill_payments");
    expect(await executarAlteracao(p)).toEqual({ ok: true });
    expect(calls.list.filter((c) => c.fn === "undoPayment")[0].arg).toEqual([["id", U(80)], ["month", "2026-11"]]);

    db.rows.fin_one_off_bills = AVULSA;
    expect(await exec("financas", { acao: "concluir", secao: "contas_avulsas", id: U(17), data: "2026-12-09" })).toEqual({ ok: true });
    expect(calls.list.filter((c) => c.fn === "payOneOff")[0].arg).toEqual([["one_off_id", U(17)], ["transaction_id", "sem"], ["paid_on", "2026-12-09"]]);
  });

  it("orçamento: salvar manda categoria/escopo/mês/valor; apagar manda o valor vazio (como a tela)", async () => {
    db.rows.fin_budgets = { id: U(19), category_id: CAT_MERCADO.id, month: null, amount: 1500 };
    expect(await exec("financas", { acao: "apagar", secao: "orcamento", categoria: "Mercado" })).toEqual({ ok: true });
    expect(await exec("financas", { acao: "editar", secao: "orcamento", categoria: "Mercado", valor: 1700 })).toEqual({ ok: true });
    expect(calls.list[0]).toEqual({ fn: "saveBudget", arg: [["category_id", CAT_MERCADO.id], ["scope", "todos"], ["month", "2026-11"], ["amount", ""]] });
    expect(calls.list[1]).toEqual({ fn: "saveBudget", arg: [["category_id", CAT_MERCADO.id], ["scope", "todos"], ["month", "2026-11"], ["amount", "1700,00"]] });
  });
});

describe("Oli escrita (etapa 3): painel", () => {
  const render = (data: unknown) =>
    renderToStaticMarkup(createElement(OliPanels, { panels: [{ id: "1", kind: "confirmar_alteracao", status: "pendente", data: data as never }], onConfirm: () => {}, onCancel: () => {}, onClear: () => {} }));

  it("apagar evento: título, alerta vermelho do Google com role note e testid", () => {
    const lk = { ...AGENDA, extra: { evento: { editavel: true, dono: "Gabriel" } } };
    const data = { ...okPlan("agenda", { acao: "apagar", secao: "eventos", id: U(13) }, EVENTO, lk).preview, aviso: eventoApagarAviso("gabriel@gmail.com", 0) };
    const html = render(data);
    expect(html).toContain("Apagar evento?");
    expect(html).toContain("Agenda ·");
    expect(html).toContain("inclusive no Google Calendar");
    const m = /<p role="note"[^>]*data-testid="alteracao-aviso"[^>]*>Este evento será apagado de verdade da agenda “gabriel@gmail.com” do Google Calendar[^<]*<\/p>/.exec(html);
    expect(m?.[0]).toMatch(/bg-danger\/10/);
    expect(m?.[0]).toMatch(/text-danger/);
  });

  it("desfazer pagamento: título próprio e botão de perigo; marcar paga: título normal", () => {
    const pag = { mes: "2026-11", pagamento: { id: U(80), auto: false, paid_on: "2026-11-05", amount: 187.9 }, tx: null, usos: { fixed: [], oneOff: [] } };
    const desfazer = okPlan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16), pago: false }, CONTA_FIXA, { ...FIN, extra: { pag } }).preview;
    const h1 = render(desfazer);
    expect(h1).toContain("Desfazer o pagamento da conta?");
    expect(h1).toContain('data-testid="alteracao-aviso"');
    const marcar = okPlan("financas", { acao: "concluir", secao: "contas_fixas", id: U(16) }, CONTA_FIXA, { ...FIN, extra: { pag: { ...pag, pagamento: null } } }).preview;
    expect(render(marcar)).toContain("Marcar a conta como paga?");
    expect(render(marcar)).not.toContain('data-testid="alteracao-aviso"');
  });

  it("apagar lançamento e textos do banco aparecem como texto (sem HTML)", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const p = okPlan("financas", { acao: "apagar", secao: "lancamentos", id: U(15) }, { ...LANC, description: evil }, FIN).preview;
    const html = render({ ...p, aviso: lancamentoApagarAviso({ valor: -1, conta: evil, data: "2026-11-10" }, { fixas: 0, avulsas: 0 }) });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Apagar lançamento?");
    expect(html).toContain("Finanças ·");
  });

  it("consulta e medicamento: títulos da situação", () => {
    expect(render(okPlan("saude", { acao: "concluir", secao: "consultas", id: U(9) }, CONSULTA).preview)).toContain("Mudar a situação da consulta?");
    expect(render(okPlan("saude", { acao: "concluir", secao: "medicamentos", id: U(10), ativo: false }, MEDICAMENTO).preview)).toContain("Encerrar o medicamento?");
  });
});
