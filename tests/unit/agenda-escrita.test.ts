import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const SECRET = "client-secret-de-teste";
const H = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as { fn: string; token: string; calendar: string; event: string; etag?: string | null }[],
  patchErr: null as number | null,
  deleteErr: null as number | null,
}));

vi.mock("@/lib/data", () => ({ getAppContext: vi.fn() }));
vi.mock("@/lib/family-access", () => ({ agendaAllowedFor: () => true }));
vi.mock("@/lib/google/config", () => ({
  googleConfigured: () => true,
  googleCredentials: () => ({ clientId: "id", clientSecret: "client-secret-de-teste" }),
}));
// O token de acesso nasce do refresh token decifrado: "at:<refresh>" prova de qual conta ele veio.
vi.mock("@/lib/google/oauth", async () => {
  const real = await vi.importActual<typeof import("@/lib/google/oauth")>("@/lib/google/oauth");
  return { ...real, accessTokenFor: async (_id: string, _ct: string, rt: () => string) => `at:${rt()}`, forgetAccessToken: () => {} };
});
vi.mock("@/lib/google/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/google/api")>("@/lib/google/api");
  const ev = (id: string) => ({ id, etag: '"novo"', status: "confirmed", summary: "Editado", start: { dateTime: "2026-11-10T10:00:00-03:00" }, end: { dateTime: "2026-11-10T11:00:00-03:00" } });
  return {
    ...real,
    patchEvent: async (token: string, calendar: string, event: string, _b: unknown, etag: string | null) => {
      st.calls.push({ fn: "patch", token, calendar, event, etag });
      if (st.patchErr) throw new real.GoogleApiError("x", st.patchErr);
      return ev(event);
    },
    deleteEvent: async (token: string, calendar: string, event: string, etag: string | null) => {
      st.calls.push({ fn: "delete", token, calendar, event, etag });
      if (st.deleteErr) throw new real.GoogleApiError("x", st.deleteErr);
      return null;
    },
    getEvent: async (token: string, calendar: string, event: string) => {
      st.calls.push({ fn: "get", token, calendar, event });
      return ev(event);
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => {
      const filters: [string, unknown][] = [];
      let mode: "select" | "update" | "delete" | "upsert" = "select";
      let patch: Row = {};
      const match = () => (st.tables[t] ?? []).filter((r) => filters.every(([k, v]) => (v && typeof v === "object" && "in" in v ? (v as { in: unknown[] }).in.includes(r[k]) : r[k] === v)));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        update: (p: Row) => ((mode = "update"), (patch = p), q),
        delete: () => ((mode = "delete"), q),
        upsert: (row: Row) => {
          mode = "upsert";
          patch = row;
          return q;
        },
        in: (k: string, vs: unknown[]) => (filters.push([k, { in: vs }]), q),
        lt: () => q,
        gte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: match()[0] ?? null }),
        single: async () => ({ data: { id: "ev-saved" }, error: null }),
        then: (res: (v: unknown) => unknown) => {
          if (mode === "update") match().forEach((r) => Object.assign(r, patch));
          if (mode === "delete") {
            const gone = new Set(match());
            st.tables[t] = (st.tables[t] ?? []).filter((r) => !gone.has(r));
          }
          return Promise.resolve({ data: mode === "select" ? match() : null, error: null }).then(res);
        },
      };
      return q;
    },
  }),
}));

import { removeEvent, updateEvent, getEventsBetween } from "@/lib/google/agenda";
import { sealToken, tokenAad } from "@/lib/google/crypto";

const GABRIEL = { id: "m-gabriel", name: "Gabriel" };
const KAREN = { id: "m-karen", name: "Karen" };
const ctx = (household = H, me = GABRIEL) => ({ household: { id: household }, me, members: [GABRIEL, KAREN] }) as never;
const input = { title: "Editado", allDay: false, start: "2026-11-10T10:00", end: "2026-11-10T11:00", location: null, description: null } as never;

const account = (id: string, member: typeof KAREN, over: Row = {}) => ({
  id,
  household_id: H,
  member_id: member.id,
  google_sub: `sub-${id}`,
  email: `${id}@x.com`,
  status: "ok",
  last_error: null,
  last_sync_at: null,
  token_ciphertext: sealToken(`refresh-${id}`, SECRET, tokenAad(H, `sub-${id}`)),
  ...over,
});

beforeEach(() => {
  st.calls = [];
  st.patchErr = null;
  st.deleteErr = null;
  st.tables = {
    google_accounts: [account("acc-g", GABRIEL), account("acc-k", KAREN)],
    cal_calendars: [
      { id: "cal-k", household_id: H, account_ref: "acc-k", google_calendar_id: "karen@x.com", summary: "Karen", color: null, access_role: "owner", selected: true, sync_token: null },
      { id: "cal-k-ro", household_id: H, account_ref: "acc-k", google_calendar_id: "feriados", summary: "Feriados", color: null, access_role: "reader", selected: true, sync_token: null },
    ],
    cal_events: [
      { id: "ev-k", household_id: H, calendar_ref: "cal-k", google_event_id: "g-k", etag: '"e1"' },
      { id: "ev-ro", household_id: H, calendar_ref: "cal-k-ro", google_event_id: "g-ro", etag: '"e2"' },
      { id: "ev-outra", household_id: OUTRA, calendar_ref: "cal-x", google_event_id: "g-x", etag: '"e3"' },
    ],
  };
});

describe("membro da família edita e exclui na agenda do cônjuge", () => {
  it("edita evento de calendário gravável do cônjuge usando o token da conta DONA, com If-Match", async () => {
    expect(await updateEvent(ctx(), "ev-k", input)).toEqual({ ok: true, id: "ev-saved" });
    expect(st.calls).toEqual([{ fn: "patch", token: "at:refresh-acc-k", calendar: "karen@x.com", event: "g-k", etag: '"e1"' }]);
  });
  it("exclui evento do cônjuge com o token da dona e apaga a cópia local", async () => {
    expect(await removeEvent(ctx(), "ev-k")).toEqual({ ok: true, id: "ev-k" });
    expect(st.calls).toEqual([{ fn: "delete", token: "at:refresh-acc-k", calendar: "karen@x.com", event: "g-k", etag: '"e1"' }]);
    expect(st.tables.cal_events.find((e) => e.id === "ev-k")).toBeUndefined();
  });
  it("412 na exclusão recarrega e avisa conflito; 404/410 contam como já apagado", async () => {
    st.deleteErr = 412;
    const r = await removeEvent(ctx(), "ev-k");
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining("mudou no Google") });
    expect(st.tables.cal_events.find((e) => e.id === "ev-k")).toBeDefined();
    st.deleteErr = 410;
    expect(await removeEvent(ctx(), "ev-k")).toEqual({ ok: true, id: "ev-k" });
  });
  it("calendário somente leitura (reader) é recusado, com erro claro e sem chamar o Google", async () => {
    for (const r of [await updateEvent(ctx(), "ev-ro", input), await removeEvent(ctx(), "ev-ro")]) {
      expect(r).toEqual({ ok: false, erro: "Esta agenda é somente leitura no Google." });
    }
    expect(st.calls).toEqual([]);
  });
  it("membro de OUTRA família: id de evento alheio é 'não encontrado' e nada vai ao Google", async () => {
    const intruso = ctx(OUTRA, { id: "m-x", name: "X" });
    expect(await updateEvent(intruso, "ev-k", input)).toEqual({ ok: false, erro: "Evento não encontrado." });
    expect(await removeEvent(intruso, "ev-k")).toEqual({ ok: false, erro: "Evento não encontrado." });
    expect(await removeEvent(ctx(), "ev-outra")).toEqual({ ok: false, erro: "Evento não encontrado." });
    expect(st.calls).toEqual([]);
  });
  it("conta do cônjuge revogada: erro claro com o nome, sem tentar o Google", async () => {
    st.tables.google_accounts = [account("acc-g", GABRIEL), account("acc-k", KAREN, { status: "revogado" })];
    const erro = "A conta de Karen precisa ser reconectada por ela.";
    expect(await updateEvent(ctx(), "ev-k", input)).toEqual({ ok: false, erro });
    expect(await removeEvent(ctx(), "ev-k")).toEqual({ ok: false, erro });
    expect(st.calls).toEqual([]);
  });
  it("editable na Agenda: qualquer membro vê gravável nas agendas owner/writer do cônjuge", async () => {
    st.tables.cal_events = [
      { id: "ev-k", household_id: H, calendar_ref: "cal-k", title: "A", all_day: false, starts_at: "2026-11-10T13:00:00Z", ends_at: "2026-11-10T14:00:00Z" },
      { id: "ev-ro", household_id: H, calendar_ref: "cal-k-ro", title: "B", all_day: false, starts_at: "2026-11-10T13:00:00Z", ends_at: "2026-11-10T14:00:00Z" },
    ];
    const evs = await getEventsBetween(ctx(), "2026-11-10", "2026-11-10");
    expect(evs.map((e) => [e.id, e.owner, e.editable])).toEqual([
      ["ev-k", "Karen", true],
      ["ev-ro", "Karen", false],
    ]);
  });
});
