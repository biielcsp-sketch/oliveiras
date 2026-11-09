import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

import { createHash } from "node:crypto";
import { openToken, pkceChallenge, randomToken, safeEqual, sealToken, tokenAad } from "@/lib/google/crypto";
import {
  buildAuthUrl,
  checkState,
  decodeState,
  encodeState,
  exchangeCode,
  GoogleOAuthError,
  missingScopes,
  newOAuthState,
  parseIdToken,
  revokeToken,
} from "@/lib/google/oauth";
import { GOOGLE_DEFAULTS, googleEndpoints, testBase } from "@/lib/google/config";
import { agendaAllowedFor, familyAllowed } from "@/lib/family-access";
import {
  addDays,
  isDate,
  normalizeLocal,
  spLocalToRfc3339,
  spMidnightIso,
  toSpLocal,
  weekStart,
} from "@/lib/agenda/dates";
import {
  defaultSelected,
  eventTimeToIso,
  planEventChanges,
  safeGoogleLink,
  staleAfterFullSync,
  syncWindow,
  toCalendarRow,
  toEventRow,
  toGoogleBody,
} from "@/lib/agenda/google-events";
import { eventInputFromForm, validateEventInput } from "@/lib/agenda/input";
import { dotsByDay, eventDays, formValues, groupByDay, timeLabel, whenLabel, type AgendaEvent } from "@/lib/agenda/view";
import { OLI_TOOL_NAMES, parseAgendaPeriodoArgs, parseCriarEventoArgs } from "@/lib/oli/tool-args";
import { buildEventos, pushPanel, resolveEvento, type OliPanel } from "@/lib/oli/panels";
import { OLI_PERSONA, OLI_TOOLS } from "@/lib/oli/prompt";
import { PanelView } from "@/components/oli/oli-panels";

const SECRET = "client-secret-de-teste";
const AAD = tokenAad("hh-1", "sub-1");

describe("criptografia do refresh token (AES-256-GCM + HKDF)", () => {
  it("ida e volta, formato v1 e iv aleatório", () => {
    const a = sealToken("1//refresh-token", SECRET, AAD);
    const b = sealToken("1//refresh-token", SECRET, AAD);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
    expect(openToken(a, SECRET, AAD)).toBe("1//refresh-token");
  });
  it("adulteração detectada (texto, tag, iv)", () => {
    const s = sealToken("segredo", SECRET, AAD).split(".");
    const flip = (x: string) => (x[0] === "A" ? "B" : "A") + x.slice(1);
    for (const i of [1, 2, 3]) {
      const t = [...s];
      t[i] = flip(t[i]);
      expect(() => openToken(t.join("."), SECRET, AAD)).toThrow();
    }
  });
  it("chave errada ou conta errada (AAD) falha", () => {
    const s = sealToken("segredo", SECRET, AAD);
    expect(() => openToken(s, "outro-secret", AAD)).toThrow();
    expect(() => openToken(s, SECRET, tokenAad("hh-1", "sub-2"))).toThrow();
  });
  it("formato inválido ou outra versão falha", () => {
    const s = sealToken("segredo", SECRET, AAD);
    expect(() => openToken(s.replace(/^v1/, "v2"), SECRET, AAD)).toThrow();
    expect(() => openToken("v1.abc", SECRET, AAD)).toThrow();
    expect(() => openToken(`${s}.x`, SECRET, AAD)).toThrow();
  });
});

describe("OAuth do Google: escopo email ausente e revogação", () => {
  const SCOPES =
    "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
  const jwt = (c: object) => `e30.${Buffer.from(JSON.stringify(c)).toString("base64url")}.sig`;
  const reply = (status: number, body: object) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const tokenBody = (idToken?: string) => ({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    scope: SCOPES,
    id_token: idToken,
  });
  const claims = { iss: "https://accounts.google.com", aud: "cid", exp: Date.now() / 1000 + 600, sub: "123" };

  const run = async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    try {
      return await exchangeCode("code", "verifier", "https://x.test/cb");
    } finally {
      vi.unstubAllEnvs();
    }
  };

  it("sem email no id_token = missing_scopes (mostra 'permissões')", async () => {
    vi.stubGlobal("fetch", reply(200, tokenBody(jwt(claims))));
    await expect(run()).rejects.toMatchObject({ code: "missing_scopes" });
    vi.unstubAllGlobals();
  });
  it("sem id_token = missing_scopes", async () => {
    vi.stubGlobal("fetch", reply(200, tokenBody(undefined)));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(GoogleOAuthError);
    expect(err.code).toBe("missing_scopes");
    vi.unstubAllGlobals();
  });
  it("com email segue normal", async () => {
    vi.stubGlobal("fetch", reply(200, tokenBody(jwt({ ...claims, email: "A@B.com" }))));
    expect((await run()).identity).toEqual({ sub: "123", email: "a@b.com" });
    vi.unstubAllGlobals();
  });

  it("revokeToken: 200 ok, 400 invalid_token ok, outro 400 e 5xx = falha", async () => {
    vi.stubGlobal("fetch", reply(200, {}));
    expect(await revokeToken("t")).toBe(true);
    vi.stubGlobal("fetch", reply(400, { error: "invalid_token" }));
    expect(await revokeToken("t")).toBe(true);
    vi.stubGlobal("fetch", reply(400, { error: "invalid_request" }));
    expect(await revokeToken("t")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 400 })));
    expect(await revokeToken("t")).toBe(false);
    vi.stubGlobal("fetch", reply(500, {}));
    expect(await revokeToken("t")).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("PKCE e state", () => {
  it("code_challenge S256 = base64url(sha256(verifier)) — vetor da RFC 7636", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const v = randomToken(48);
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(pkceChallenge(v)).toBe(createHash("sha256").update(v).digest("base64url"));
  });
  it("state: confere em tempo constante, usuário e validade", () => {
    const s = newOAuthState("user-1", 1_000);
    const back = decodeState(encodeState(s));
    expect(back).toEqual(s);
    expect(checkState(back, s.state, "user-1", 2_000)).toBe(true);
    expect(checkState(back, `${s.state}x`, "user-1", 2_000)).toBe(false);
    expect(checkState(back, null, "user-1", 2_000)).toBe(false);
    expect(checkState(back, s.state, "user-2", 2_000)).toBe(false);
    expect(checkState(back, s.state, "user-1", s.exp + 1)).toBe(false);
    expect(checkState(null, s.state, "user-1", 2_000)).toBe(false);
    expect(decodeState("lixo")).toBeNull();
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("", "")).toBe(false);
  });
  it("URL de autorização: offline, consent, escopos, PKCE S256", () => {
    const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" };
    const s = newOAuthState("u");
    const url = new URL(buildAuthUrl(s, "https://oliveiras-swart.vercel.app/api/google/callback", env));
    expect(url.origin + url.pathname).toBe(GOOGLE_DEFAULTS.authorize);
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      client_id: "cid",
      redirect_uri: "https://oliveiras-swart.vercel.app/api/google/callback",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      code_challenge_method: "S256",
      code_challenge: pkceChallenge(s.verifier),
      state: s.state,
    });
    expect(q.scope.split(" ")).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
    expect(url.searchParams.has("code_verifier")).toBe(false);
  });
  it("id_token: iss, aud, exp, sub e email", () => {
    const jwt = (c: object) => `e30.${Buffer.from(JSON.stringify(c)).toString("base64url")}.sig`;
    const now = 1_700_000_000_000;
    const good = { iss: "https://accounts.google.com", aud: "cid", exp: now / 1000 + 60, sub: "123", email: "A@B.com" };
    expect(parseIdToken(jwt(good), "cid", now)).toEqual({ sub: "123", email: "a@b.com" });
    expect(parseIdToken(jwt({ ...good, iss: "accounts.google.com" }), "cid", now).sub).toBe("123");
    expect(() => parseIdToken(jwt({ ...good, iss: "https://evil.example" }), "cid", now)).toThrow();
    expect(() => parseIdToken(jwt({ ...good, aud: "outro" }), "cid", now)).toThrow();
    expect(() => parseIdToken(jwt({ ...good, exp: now / 1000 - 1 }), "cid", now)).toThrow();
    expect(() => parseIdToken(jwt({ ...good, email: undefined }), "cid", now)).toThrow();
    expect(() => parseIdToken("abc", "cid", now)).toThrow();
  });
  it("escopos obrigatórios", () => {
    expect(missingScopes("openid https://www.googleapis.com/auth/calendar.events")).toEqual([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
    expect(
      missingScopes("https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events"),
    ).toEqual([]);
  });
  it("bases de teste só em localhost; padrão são os endpoints reais", () => {
    expect(googleEndpoints({})).toEqual(GOOGLE_DEFAULTS);
    expect(googleEndpoints({ GOOGLE_OAUTH_BASE: "http://127.0.0.1:4020/", GOOGLE_API_BASE: "http://localhost:4020/calendar/v3" })).toEqual({
      authorize: "http://127.0.0.1:4020/o/oauth2/v2/auth",
      token: "http://127.0.0.1:4020/token",
      revoke: "http://127.0.0.1:4020/revoke",
      api: "http://localhost:4020/calendar/v3",
    });
    expect(() => testBase("https://evil.example", "X")).toThrow();
    expect(() => testBase("http://localhost.evil.example", "X")).toThrow();
    expect(() => testBase("http://user@localhost:1", "X")).toThrow();
    expect(testBase("", "X")).toBeNull();
  });
  it("família autorizada: variável própria, senão a do Oli/Pluggy; vazio = ausente", () => {
    expect(agendaAllowedFor("a", { AGENDA_HOUSEHOLD_ID: "a" })).toBe(true);
    expect(agendaAllowedFor("a", { AGENDA_HOUSEHOLD_ID: "", OLI_HOUSEHOLD_ID: "a" })).toBe(true);
    expect(agendaAllowedFor("a", { PLUGGY_HOUSEHOLD_ID: "a" })).toBe(true);
    expect(agendaAllowedFor("b", { AGENDA_HOUSEHOLD_ID: "a", OLI_HOUSEHOLD_ID: "b" })).toBe(false);
    expect(agendaAllowedFor("a", {})).toBe(false);
    expect(familyAllowed(null, { OLI_HOUSEHOLD_ID: "a" })).toBe(false);
  });
});

describe("datas (São Paulo)", () => {
  it("dia inteiro: meia-noite de São Paulo; dateTime: respeita o offset", () => {
    expect(spMidnightIso("2026-11-08")).toBe("2026-11-08T03:00:00.000Z");
    expect(eventTimeToIso({ date: "2026-11-08" })).toEqual({ iso: "2026-11-08T03:00:00.000Z", allDay: true });
    expect(eventTimeToIso({ dateTime: "2026-11-08T19:00:00-03:00" })).toEqual({ iso: "2026-11-08T22:00:00.000Z", allDay: false });
    expect(eventTimeToIso({ dateTime: "2026-11-08T19:00:00Z" })?.iso).toBe("2026-11-08T19:00:00.000Z");
    expect(eventTimeToIso({ dateTime: "lixo" })).toBeNull();
  });
  it("horário de verão antigo (2018) usa o offset da época", () => {
    expect(spLocalToRfc3339("2018-12-01T10:00")).toBe("2018-12-01T10:00:00-02:00");
    expect(spLocalToRfc3339("2026-11-08T10:00")).toBe("2026-11-08T10:00:00-03:00");
    expect(toSpLocal("2026-11-08T22:00:00.000Z")).toBe("2026-11-08T19:00");
  });
  it("validação e aritmética de datas", () => {
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(normalizeLocal("2026-11-08T19:00:59")).toBe("2026-11-08T19:00");
    expect(normalizeLocal("2026-11-08T24:00")).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStart("2026-11-11")).toBe("2026-11-08");
  });
});

describe("evento do Google → linha", () => {
  it("dia inteiro com fim exclusivo", () => {
    const r = toEventRow({ id: "e1", etag: '"1"', status: "confirmed", summary: "Feriado", start: { date: "2026-11-15" }, end: { date: "2026-11-16" } })!;
    expect(r).toMatchObject({ all_day: true, starts_at: "2026-11-15T03:00:00.000Z", ends_at: "2026-11-16T03:00:00.000Z", title: "Feriado" });
    const ev = { startsAt: r.starts_at, endsAt: r.ends_at, allDay: true };
    expect(eventDays(ev)).toEqual(["2026-11-15"]);
    expect(timeLabel(ev)).toBe("Dia inteiro");
  });
  it("com horário, recorrente, link seguro e campos longos cortados", () => {
    const r = toEventRow({
      id: "e2_20261108T220000Z",
      status: "tentative",
      summary: "x".repeat(2000),
      location: "Igreja",
      start: { dateTime: "2026-11-08T19:00:00-03:00" },
      end: { dateTime: "2026-11-08T21:00:00-03:00" },
      recurringEventId: "e2",
      htmlLink: "https://www.google.com/calendar/event?eid=abc",
      updated: "2026-11-01T10:00:00.000Z",
    })!;
    expect(r).toMatchObject({ status: "tentative", all_day: false, starts_at: "2026-11-08T22:00:00.000Z", ends_at: "2026-11-09T00:00:00.000Z", recurring_event_id: "e2" });
    expect(r.title).toHaveLength(1024);
    expect(r.html_link).toBe("https://www.google.com/calendar/event?eid=abc");
    expect(safeGoogleLink("javascript:alert(1)")).toBeNull();
    expect(safeGoogleLink("https://evil.example/calendar")).toBeNull();
  });
  it("cancelado, sem id ou sem datas → null; fim antes do início vira início", () => {
    expect(toEventRow({ id: "x", status: "cancelled" })).toBeNull();
    expect(toEventRow({ status: "confirmed", start: { date: "2026-11-15" } })).toBeNull();
    expect(toEventRow({ id: "x", start: {} })).toBeNull();
    const r = toEventRow({ id: "x", start: { dateTime: "2026-11-08T19:00:00Z" }, end: { dateTime: "2026-11-08T18:00:00Z" } })!;
    expect(r.ends_at).toBe(r.starts_at);
  });
  it("agendas: cor só hex, papel conhecido, selecionadas só owner/writer", () => {
    expect(toCalendarRow({ id: "a@b.com", summary: "A", summaryOverride: "Minha", backgroundColor: "#9FE1E7", accessRole: "owner" })).toEqual({
      google_calendar_id: "a@b.com",
      summary: "Minha",
      color: "#9fe1e7",
      access_role: "owner",
    });
    expect(toCalendarRow({ id: "f", summary: "Feriados", backgroundColor: "red", accessRole: "hacker" })).toMatchObject({ color: null, access_role: null });
    expect([defaultSelected("owner"), defaultSelected("writer"), defaultSelected("reader"), defaultSelected(null)]).toEqual([true, true, false, false]);
  });
});

describe("plano de sincronização", () => {
  const win = syncWindow("2026-11-08");
  const ev = (id: string, day: string, extra = {}) => ({ id, status: "confirmed", summary: id, start: { date: day }, end: { date: addDays(day, 1) }, ...extra });
  it("janela: hoje −60 a +365 dias", () => {
    expect(win).toEqual({ min: spMidnightIso("2026-09-09"), max: spMidnightIso("2027-11-08") });
  });
  it("insere/atualiza, apaga cancelados e o que saiu da janela; último estado do mesmo id vale", () => {
    const plan = planEventChanges(
      [
        ev("a", "2026-11-10"),
        ev("b", "2026-11-11"),
        { id: "c", status: "cancelled" },
        ev("antigo", "2025-01-01"),
        ev("b", "2026-11-11", { status: "cancelled" }),
        ev("c", "2026-11-12"),
      ],
      win,
    );
    expect(plan.upserts.map((u) => u.google_event_id).sort()).toEqual(["a", "c"]);
    expect(plan.deletes.sort()).toEqual(["antigo", "b"]);
  });
  it("carga completa remove o que só existe aqui (equivale ao 410 → limpar e recarregar)", () => {
    expect(staleAfterFullSync(["a", "b", "z"], ["a", "b"])).toEqual(["z"]);
    expect(staleAfterFullSync([], ["a"])).toEqual([]);
  });
});

describe("formulário de evento", () => {
  it("valida título, datas, fim ≥ início, limites", () => {
    expect(validateEventInput({ title: " ", start: "2026-11-08T10:00" })).toEqual({ ok: false, erro: "Dê um título ao evento." });
    expect(validateEventInput({ title: "x".repeat(301), start: "2026-11-08T10:00" }).ok).toBe(false);
    expect(validateEventInput({ title: "a", start: "2026-11-08T10:00", location: "x".repeat(301) }).ok).toBe(false);
    expect(validateEventInput({ title: "a", start: "2026-11-08T10:00", description: "x".repeat(2001) }).ok).toBe(false);
    expect(validateEventInput({ title: "a", start: "2026-11-08T10:00", end: "2026-11-08T09:00" })).toEqual({
      ok: false,
      erro: "O fim não pode ser antes do início.",
    });
    expect(validateEventInput({ title: "a", start: "2026-13-08T10:00" }).ok).toBe(false);
    expect(validateEventInput({ title: "a", allDay: true, start: "2026-11-10", end: "2026-11-09" }).ok).toBe(false);
    expect(validateEventInput({ title: "a", start: "2026-11-08T10:00", end: "2028-11-08T10:00" }).ok).toBe(false);
  });
  it("sem fim: 1 hora; dia inteiro sem fim: o mesmo dia", () => {
    expect(validateEventInput({ title: " Culto ", start: "2026-11-08T19:00" })).toEqual({
      ok: true,
      value: { title: "Culto", allDay: false, start: "2026-11-08T19:00", end: "2026-11-08T20:00", location: null, description: null },
    });
    const d = validateEventInput({ title: "Folga", allDay: true, start: "2026-11-10" });
    expect(d.ok && d.value).toMatchObject({ allDay: true, start: "2026-11-10", end: "2026-11-10" });
  });
  it("FormData do formulário (dia inteiro usa os campos de data)", () => {
    const f = new FormData();
    f.set("title", "Viagem");
    f.set("all_day", "on");
    f.set("start_date", "2026-12-20");
    f.set("end_date", "2026-12-22");
    f.set("start", "lixo");
    expect(validateEventInput(eventInputFromForm(f))).toMatchObject({ ok: true, value: { allDay: true, start: "2026-12-20", end: "2026-12-22" } });
  });
  it("corpo para o Google: dia inteiro com fim exclusivo; horário com offset; troca limpa o outro formato", () => {
    expect(toGoogleBody({ title: "Viagem", allDay: true, start: "2026-12-20", end: "2026-12-22", location: null, description: null })).toEqual({
      summary: "Viagem",
      location: "",
      description: "",
      start: { date: "2026-12-20", dateTime: null, timeZone: null },
      end: { date: "2026-12-23", dateTime: null, timeZone: null },
    });
    expect(toGoogleBody({ title: "Culto", allDay: false, start: "2026-11-08T19:00", end: "2026-11-08T21:00", location: "Igreja", description: "x" }).start).toEqual({
      date: null,
      dateTime: "2026-11-08T19:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });
  });
});

const agendaEvent = (over: Partial<AgendaEvent>): AgendaEvent => ({
  id: "1",
  title: "Culto",
  allDay: false,
  startsAt: "2026-11-08T22:00:00.000Z",
  endsAt: "2026-11-09T00:00:00.000Z",
  location: "Igreja",
  description: null,
  htmlLink: null,
  calendarId: "c1",
  calendarName: "Gabriel",
  color: "#1a79a8",
  memberId: "m1",
  owner: "Você",
  editable: true,
  ...over,
});

describe("tela da Agenda", () => {
  it("agrupa por dia (evento de vários dias aparece em cada dia), dia inteiro primeiro", () => {
    const evs = [
      agendaEvent({ id: "1" }),
      agendaEvent({ id: "2", title: "Viagem", allDay: true, startsAt: spMidnightIso("2026-11-08"), endsAt: spMidnightIso("2026-11-10") }),
    ];
    const g = groupByDay(evs, "2026-11-08", "2026-11-10");
    expect(g.map((d) => [d.day, d.events.map((e) => e.id)])).toEqual([
      ["2026-11-08", ["2", "1"]],
      ["2026-11-09", ["2"]],
      ["2026-11-10", []],
    ]);
    expect(timeLabel(evs[0])).toBe("19:00 – 21:00");
    expect(whenLabel(evs[1])).toMatch(/a .* · Dia inteiro$/);
    expect(formValues(evs[1])).toEqual({ start: "2026-11-08", end: "2026-11-09" });
    expect(dotsByDay(evs)).toEqual({ "2026-11-08": ["#1a79a8"], "2026-11-09": ["#1a79a8"] });
  });
  it("evento que termina à meia-noite não ocupa o dia seguinte", () => {
    expect(eventDays({ allDay: false, startsAt: "2026-11-08T23:00:00.000Z", endsAt: "2026-11-09T03:00:00.000Z" })).toEqual(["2026-11-08"]);
  });
});

describe("Oli: ferramentas da Agenda", () => {
  it("declaradas no token e na persona", () => {
    expect(OLI_TOOL_NAMES).toContain("agenda_periodo");
    expect(OLI_TOOL_NAMES).toContain("criar_evento");
    const names = OLI_TOOLS[0].functionDeclarations!.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["agenda_periodo", "criar_evento"]));
    expect(OLI_PERSONA).toMatch(/criar_evento/);
  });
  it("agenda_periodo: padrão hoje +7, máximo 31 dias, datas válidas", () => {
    expect(parseAgendaPeriodoArgs({}, "2026-11-08")).toEqual({ ok: true, value: { de: "2026-11-08", ate: "2026-11-15", pessoa: undefined } });
    expect(parseAgendaPeriodoArgs({ de: "2026-11-01", ate: "2026-12-02" }, "2026-11-08")).toEqual({ ok: true, value: { de: "2026-11-01", ate: "2026-12-02", pessoa: undefined } });
    expect(parseAgendaPeriodoArgs({ de: "2026-11-01", ate: "2026-12-03" }, "2026-11-08").ok).toBe(false);
    expect(parseAgendaPeriodoArgs({ de: "2026-11-10", ate: "2026-11-09" }, "2026-11-08").ok).toBe(false);
    expect(parseAgendaPeriodoArgs({ de: "ontem" }, "2026-11-08").ok).toBe(false);
    expect(parseAgendaPeriodoArgs({ pessoa: "Karen" }, "2026-11-08")).toMatchObject({ ok: true, value: { pessoa: "Karen" } });
  });
  it("criar_evento: data sem hora vira dia inteiro; horário normalizado; tipos validados", () => {
    expect(parseCriarEventoArgs({ titulo: "Folga", inicio: "2026-11-10" })).toEqual({
      ok: true,
      value: { titulo: "Folga", dia_inteiro: true, inicio: "2026-11-10", fim: undefined, local: undefined, agenda: undefined },
    });
    expect(parseCriarEventoArgs({ titulo: "Culto", inicio: "2026-11-08T19:00:00", fim: "2026-11-08T21:00" })).toMatchObject({
      ok: true,
      value: { dia_inteiro: false, inicio: "2026-11-08T19:00", fim: "2026-11-08T21:00" },
    });
    expect(parseCriarEventoArgs({ titulo: "", inicio: "2026-11-10" }).ok).toBe(false);
    expect(parseCriarEventoArgs({ titulo: "a", inicio: "amanhã" }).ok).toBe(false);
    expect(parseCriarEventoArgs({ titulo: "a", inicio: "2026-11-10", dia_inteiro: "sim" }).ok).toBe(false);
    expect(parseCriarEventoArgs({ titulo: "a", inicio: "2026-11-10T10:00", dia_inteiro: true })).toMatchObject({ ok: true, value: { inicio: "2026-11-10" } });
  });
  it("resolve a agenda pelo nome ou a principal; ambíguo → erro com opções, sem adivinhar", () => {
    const cals = [
      { id: "c1", summary: "gabriel@gmail.com", primary: true },
      { id: "c2", summary: "Igreja", primary: false },
      { id: "c3", summary: "Igreja jovens", primary: false },
    ];
    const args = { titulo: "Culto", dia_inteiro: false, inicio: "2026-11-08T19:00" };
    expect(resolveEvento(args, cals)).toMatchObject({ ok: true, preview: { agenda: { id: "c1" }, fim: "2026-11-08T20:00" } });
    expect(resolveEvento({ ...args, agenda: "igreja" }, cals)).toMatchObject({ ok: true, preview: { agenda: { id: "c2" } } });
    const amb = resolveEvento({ ...args, agenda: "igre" }, cals);
    expect(amb.ok).toBe(false);
    expect(!amb.ok && amb.erro).toContain("Opções: gabriel@gmail.com, Igreja, Igreja jovens");
    const semPrincipal = resolveEvento(args, cals.slice(1));
    expect(semPrincipal.ok).toBe(false);
    expect(resolveEvento(args, [])).toEqual({ ok: false, erro: "Nenhuma agenda sua conectada. Conecte o Google na tela Agenda." });
    expect(resolveEvento({ ...args, fim: "2026-11-08T18:00" }, cals).ok).toBe(false);
  });
  it("painel de eventos: um item por evento, no primeiro dia dentro do período", () => {
    const d = buildEventos(
      [
        agendaEvent({ id: "1", owner: "Karen", color: "#ff0000" }),
        agendaEvent({ id: "2", title: " ", allDay: true, startsAt: spMidnightIso("2026-11-06"), endsAt: spMidnightIso("2026-11-10") }),
        agendaEvent({ id: "3", startsAt: "2026-12-30T12:00:00.000Z", endsAt: "2026-12-30T13:00:00.000Z" }),
      ],
      "2026-11-08",
      "2026-11-15",
      null,
    );
    expect(d.total).toBe(2);
    expect(d.itens.map((i) => [i.dia, i.titulo, i.hora, i.pessoa])).toEqual([
      ["2026-11-08", "(Sem título)", "Dia inteiro", "Você"],
      ["2026-11-08", "Culto", "19:00 – 21:00", "Karen"],
    ]);
  });
  it("painéis renderizam como texto (sem HTML do modelo) e a confirmação de evento fica pendente", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const eventos: OliPanel = {
      id: "p1",
      kind: "eventos",
      data: { de: "2026-11-08", ate: "2026-11-15", pessoa: null, total: 1, itens: [{ dia: "2026-11-08", hora: "19:00 – 21:00", titulo: evil, local: null, agenda: "A", pessoa: "Você", cor: "red;background:url(x)" }] },
    };
    const html = renderToStaticMarkup(createElement(PanelView, { panel: eventos, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("url(x)");
    const confirm: OliPanel = {
      id: "p2",
      kind: "confirmar_evento",
      status: "pendente",
      data: { titulo: "Culto", dia_inteiro: false, inicio: "2026-11-08T19:00", fim: "2026-11-08T21:00", local: "Igreja", agenda: { id: "c1", nome: "Gabriel" } },
    };
    const c = renderToStaticMarkup(createElement(PanelView, { panel: confirm, onConfirm: () => {}, onCancel: () => {} }));
    expect(c).toContain("Criar este evento?");
    expect(c).toContain("08/11/2026 · 19:00 – 21:00");
    expect(c).toContain("Confirmar");
    // Confirmação pendente nunca some por excesso de painéis.
    let list: OliPanel[] = [confirm];
    for (let i = 0; i < 6; i++) list = pushPanel(list, { id: `a${i}`, kind: "aviso", texto: "x" });
    expect(list.some((p) => p.id === "p2")).toBe(true);
  });
});
