import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgendaEvent } from "@/lib/agenda/view";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const H = "11111111-1111-4111-8111-111111111111";
const EV1 = "aaaaaaaa-0000-4000-8000-000000000001";
const EV2 = "aaaaaaaa-0000-4000-8000-000000000002";
const EV3 = "aaaaaaaa-0000-4000-8000-000000000003";

const state = vi.hoisted(() => ({ events: [] as unknown[], removed: [] as string[], removeResult: { ok: true } as { ok: boolean; erro?: string; id?: string } }));

vi.mock("@/lib/data", () => ({
  getAppContext: async () => ({ household: { id: "11111111-1111-4111-8111-111111111111" }, me: { id: "m1" }, members: [] }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: { starts_at: "2026-11-09T22:00:00.000Z" } });
    return { from: () => q };
  },
}));
vi.mock("@/lib/financas/data", () => ({ getFinanceBase: vi.fn(), getTransactions: vi.fn() }));
vi.mock("@/lib/financas/planning-data", () => ({ getBillPayments: vi.fn(), getBills: vi.fn(), getTransactionsAround: vi.fn() }));
vi.mock("@/lib/google/agenda", () => ({
  agendaEnabled: () => true,
  getEventsBetween: async () => state.events,
  loadAccounts: vi.fn(),
  writableCalendarsOf: vi.fn(),
  createEvent: vi.fn(),
  removeEvent: async (_ctx: unknown, id: string) => {
    state.removed.push(id);
    return state.removeResult;
  },
}));

import { confirmOliExcluirEvento, runOliTool } from "@/app/(app)/inicio/oli-actions";
import { OLI_TOOL_NAMES, parseExcluirEventoArgs } from "@/lib/oli/tool-args";
import { OLI_PERSONA, OLI_TOOLS } from "@/lib/oli/prompt";
import { buildEventos, resolveExclusao, type OliPanel } from "@/lib/oli/panels";
import { PanelView } from "@/components/oli/oli-panels";

const ev = (over: Partial<AgendaEvent>): AgendaEvent => ({
  id: EV1,
  title: "Dentista",
  allDay: false,
  startsAt: "2026-11-09T22:00:00.000Z", // 19:00 em São Paulo
  endsAt: "2026-11-09T23:00:00.000Z",
  location: null,
  description: null,
  htmlLink: null,
  calendarId: "c1",
  calendarName: "Gabriel",
  color: null,
  memberId: "m1",
  owner: "Você",
  editable: true,
  ...over,
});

beforeEach(() => {
  process.env.OLI_HOUSEHOLD_ID = H;
  state.events = [ev({})];
  state.removed = [];
  state.removeResult = { ok: true };
});

describe("excluir_evento: argumentos e declaração", () => {
  it("está na lista e declarada ao modelo, com a regra de confirmação no prompt", () => {
    expect(OLI_TOOL_NAMES).toContain("excluir_evento");
    expect(OLI_TOOLS[0].functionDeclarations!.map((f) => f.name)).toEqual([...OLI_TOOL_NAMES]);
    expect(OLI_PERSONA).toContain("excluir_evento");
    expect(OLI_PERSONA).toContain("Nunca diga que apagou antes do toque");
    expect(OLI_PERSONA).not.toContain("Só a pessoa dona da agenda");
  });
  it("aceita id UUID, ou título + data; recusa o resto", () => {
    expect(parseExcluirEventoArgs({ id: EV1.toUpperCase() })).toEqual({ ok: true, value: { id: EV1 } });
    expect(parseExcluirEventoArgs({ titulo: " Dentista ", data: "2026-11-09" })).toEqual({ ok: true, value: { titulo: "Dentista", data: "2026-11-09" } });
    expect(parseExcluirEventoArgs({ id: "abc" }).ok).toBe(false);
    expect(parseExcluirEventoArgs({ id: 5 }).ok).toBe(false);
    expect(parseExcluirEventoArgs({ titulo: "Dentista" }).ok).toBe(false);
    expect(parseExcluirEventoArgs({ data: "2026-11-09" }).ok).toBe(false);
    expect(parseExcluirEventoArgs({}).ok).toBe(false);
    expect(parseExcluirEventoArgs({ titulo: "x", data: "amanhã" }).ok).toBe(false);
    expect(parseExcluirEventoArgs({ titulo: "x".repeat(301), data: "2026-11-09" }).ok).toBe(false);
    expect(parseExcluirEventoArgs({ titulo: { a: 1 }, data: "2026-11-09" }).ok).toBe(false);
  });
  it("agenda_periodo devolve o id de cada evento para o modelo usar", () => {
    const d = buildEventos([ev({})], "2026-11-09", "2026-11-09", null);
    expect(d.itens[0].id).toBe(EV1);
  });
});

describe("excluir_evento: resolução", () => {
  it("ambíguo devolve candidatos (com id) e não escolhe; nenhum devolve erro", () => {
    const evs = [ev({}), ev({ id: EV2, owner: "Karen", editable: false })];
    const r = resolveExclusao({ titulo: "dentista", data: "2026-11-09" }, evs);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.candidatos?.map((c) => c.id)).toEqual([EV1, EV2]);
    const none = resolveExclusao({ titulo: "Médico", data: "2026-11-09" }, evs);
    expect(none).toMatchObject({ ok: false });
    expect(!none.ok && none.candidatos).toBeUndefined();
    expect(resolveExclusao({ id: EV3 }, evs).ok).toBe(false);
    const parcial = [ev({ title: "Dentista Ana" }), ev({ id: EV2, title: "Dentista Bia" })];
    expect(resolveExclusao({ titulo: "dentista", data: "2026-11-09" }, parcial).ok).toBe(false);
  });
  it("título exato vence o parcial; prepara com título, quando e agenda", () => {
    const evs = [ev({}), ev({ id: EV2, title: "Dentista Karen" })];
    expect(resolveExclusao({ titulo: "Dentista", data: "2026-11-09" }, evs)).toEqual({
      ok: true,
      preview: { id: EV1, titulo: "Dentista", quando: "seg., 9 de nov. · 19:00 – 20:00", agenda: "Gabriel", pessoa: "Você" },
    });
  });
  it("evento da agenda gravável do cônjuge: prepara, mostrando de quem é; agenda só leitura: recusa com mensagem clara", () => {
    const karen = resolveExclusao({ id: EV1 }, [ev({ owner: "Karen", calendarName: "Karen", editable: true })]);
    expect(karen).toMatchObject({ ok: true, preview: { id: EV1, agenda: "Karen", pessoa: "Karen" } });
    const roKaren = resolveExclusao({ id: EV1 }, [ev({ owner: "Karen", editable: false })]);
    expect(!roKaren.ok && roKaren.erro).toContain("somente leitura");
    const ro = resolveExclusao({ id: EV1 }, [ev({ editable: false })]);
    expect(!ro.ok && ro.erro).toContain("somente leitura");
  });
});

describe("excluir_evento: a ferramenta só prepara; a ação apaga", () => {
  it("runOliTool prepara o painel e NÃO apaga", async () => {
    const r = await runOliTool("excluir_evento", { id: EV1 });
    expect(r).toMatchObject({ ok: true, tool: "excluir_evento", data: { id: EV1, titulo: "Dentista" } });
    const r2 = await runOliTool("excluir_evento", { titulo: "Dentista", data: "2026-11-09" });
    expect(r2.ok).toBe(true);
    expect(state.removed).toEqual([]);
  });
  it("runOliTool ambíguo devolve candidatos, não-dono é recusado, argumento ruim é recusado; nada é apagado", async () => {
    state.events = [ev({}), ev({ id: EV2 })];
    const amb = await runOliTool("excluir_evento", { titulo: "Dentista", data: "2026-11-09" });
    expect(amb).toMatchObject({ ok: false, candidatos: [{ id: EV1 }, { id: EV2 }] });
    state.events = [ev({ owner: "Karen", editable: false })];
    expect(await runOliTool("excluir_evento", { id: EV1 })).toMatchObject({ ok: false, erro: expect.stringContaining("somente leitura") });
    state.events = [ev({ owner: "Karen", editable: true })];
    expect(await runOliTool("excluir_evento", { id: EV1 })).toMatchObject({ ok: true, data: { pessoa: "Karen" } });
    expect(await runOliTool("excluir_evento", { id: "x" })).toMatchObject({ ok: false });
    expect(state.removed).toEqual([]);
  });
  it("só famílias autorizadas do Oli", async () => {
    process.env.OLI_HOUSEHOLD_ID = "22222222-2222-4222-8222-222222222222";
    delete process.env.PLUGGY_HOUSEHOLD_ID;
    expect(await runOliTool("excluir_evento", { id: EV1 })).toMatchObject({ ok: false });
    expect(await confirmOliExcluirEvento(EV1)).toMatchObject({ ok: false });
    expect(state.removed).toEqual([]);
  });
  it("confirmar apaga pelo removeEvent (dono)", async () => {
    expect(await confirmOliExcluirEvento(EV1)).toEqual({ ok: true });
    expect(state.removed).toEqual([EV1]);
  });
  it("confirmar: evento do cônjuge em agenda gravável apaga; só leitura é recusado sem chamar o Google; id inválido e inexistente recusados", async () => {
    state.events = [ev({ owner: "Karen", editable: true })];
    expect(await confirmOliExcluirEvento(EV1)).toEqual({ ok: true });
    expect(state.removed).toEqual([EV1]);
    state.removed.length = 0;
    state.events = [ev({ owner: "Karen", editable: false })];
    const r = await confirmOliExcluirEvento(EV1);
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining("somente leitura") });
    expect(await confirmOliExcluirEvento("../x")).toMatchObject({ ok: false });
    state.events = [];
    expect(await confirmOliExcluirEvento(EV1)).toMatchObject({ ok: false });
    expect(state.removed).toEqual([]);
  });
  it("confirmar repassa o conflito (412) do removeEvent como erro", async () => {
    state.removeResult = { ok: false, erro: "Este evento mudou no Google. Carreguei a versão nova; confira e tente de novo." };
    expect(await confirmOliExcluirEvento(EV1)).toEqual({ ok: false, erro: state.removeResult.erro });
  });
});

describe("excluir_evento: painel", () => {
  const panel = (over: Partial<Extract<OliPanel, { kind: "confirmar_excluir_evento" }>> = {}): OliPanel => ({
    id: "p1",
    kind: "confirmar_excluir_evento",
    status: "pendente",
    data: { id: EV1, titulo: "<img src=x onerror=alert(1)>", quando: "seg., 9 de nov. · 19:00 – 20:00", agenda: "Gabriel", pessoa: "Você" },
    ...over,
  });
  const html = (p: OliPanel) => renderToStaticMarkup(createElement(PanelView, { panel: p, onConfirm: () => {}, onCancel: () => {} }));
  it("evento do cônjuge: o painel mostra de quem é a agenda", () => {
    const base = panel() as Extract<OliPanel, { kind: "confirmar_excluir_evento" }>;
    expect(html({ ...base, data: { ...base.data, agenda: "Consultas", pessoa: "Karen" } })).toContain("Consultas (agenda de Karen)");
    expect(html(panel())).not.toContain("agenda de");
  });
  it("mostra título (escapado), quando e agenda com Confirmar/Cancelar", () => {
    const h = html(panel());
    expect(h).toContain("Excluir este evento?");
    expect(h).toContain("&lt;img");
    expect(h).not.toContain("<img");
    expect(h).toContain("19:00 – 20:00");
    expect(h).toContain("Gabriel");
    expect(h).toContain("Confirmar");
    expect(h).toContain("Cancelar");
  });
  it("depois da decisão, sem botões", () => {
    expect(html(panel({ status: "criado" }))).toContain("Evento apagado do Google.");
    expect(html(panel({ status: "cancelado" }))).toContain("O evento foi mantido.");
    expect(html(panel({ status: "cancelado" }))).not.toContain("Confirmar</button>");
  });
});
