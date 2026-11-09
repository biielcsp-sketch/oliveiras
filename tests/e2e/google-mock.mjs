// Servidor que imita o Google (OAuth 2.0 + Calendar API v3) nos testes E2E. Nunca usado em produção.
// OAuth: /o/oauth2/v2/auth (consentimento automático), /token (code + PKCE, refresh), /revoke.
// Calendar: /calendar/v3/users/me/calendarList e /calendar/v3/calendars/:id/events (list com syncToken, get, insert, patch, delete).
// Controle dos testes: /__user, /__events/:cal (POST cria "no Google", GET lista), /__cancel, /__touch, /__expire, /__revoke-all, /__today.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.GOOGLE_MOCK_PORT ?? 4020);
const CLIENT_ID = "test-google-client";
const CLIENT_SECRET = "test-google-secret";
const SCOPES = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";

const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const today = fmtDate.format(new Date());
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const USERS = {
  gabriel: { sub: "1001", email: "gabriel.e2e@gmail.com" },
  karen: { sub: "2002", email: "karen.e2e@gmail.com" },
};
let nextUser = "gabriel";
const codes = new Map(); // code → { challenge, redirect, user }
const refresh = new Map(); // refresh token → { user, revoked }
const access = new Map(); // access token → user
let version = 1; // relógio das mudanças (syncToken)
const expired = new Set(); // calendários com syncToken vencido (410)
const calls = []; // log de chamadas da API (para os testes conferirem parâmetros)

// Agendas e eventos por usuário
const calendars = new Map(); // calId → { owner, entry, events: Map<id, event> }
function seed() {
  calendars.clear();
  version = 1;
  for (const [key, u] of Object.entries(USERS)) {
    calendars.set(u.email, {
      owner: key,
      entry: { id: u.email, summary: u.email, backgroundColor: key === "gabriel" ? "#1a79a8" : "#d06b64", accessRole: "owner", primary: true },
      events: new Map(),
    });
  }
  calendars.set(`feriados-${USERS.gabriel.sub}@group.v.calendar.google.com`, {
    owner: "gabriel",
    entry: { id: `feriados-${USERS.gabriel.sub}@group.v.calendar.google.com`, summary: "Feriados no Brasil", backgroundColor: "#16a765", accessRole: "reader" },
    events: new Map(),
  });
  put(USERS.gabriel.email, { summary: "Culto de domingo", location: "Igreja Lagoinha", start: { dateTime: `${today}T19:00:00-03:00` }, end: { dateTime: `${today}T21:00:00-03:00` } });
  put(USERS.gabriel.email, { summary: "Folga", start: { date: addDays(today, 1) }, end: { date: addDays(today, 2) } });
  put(USERS.karen.email, { summary: "Consulta Karen", location: "Clínica", start: { dateTime: `${addDays(today, 2)}T10:00:00-03:00` }, end: { dateTime: `${addDays(today, 2)}T11:00:00-03:00` } });
  // Fora da janela (−60 dias): não pode vir na carga completa.
  put(USERS.gabriel.email, { summary: "Evento antigo", start: { date: addDays(today, -90) }, end: { date: addDays(today, -89) } });
}

function put(calId, fields, id) {
  const cal = calendars.get(calId);
  const ev = cal.events.get(id) ?? { id: id ?? `ev${randomBytes(5).toString("hex")}`, status: "confirmed" };
  Object.assign(ev, fields);
  for (const k of ["start", "end"]) {
    if (ev[k]) for (const [kk, vv] of Object.entries(ev[k])) if (vv === null) delete ev[k][kk];
  }
  ev.v = ++version;
  ev.etag = `"${ev.v}"`;
  ev.updated = new Date().toISOString();
  ev.htmlLink = `https://www.google.com/calendar/event?eid=${ev.id}`;
  cal.events.set(ev.id, ev);
  return ev;
}

const pub = (ev) => Object.fromEntries(Object.entries(ev).filter(([k]) => k !== "v"));
const startMs = (ev) => Date.parse(ev.start?.dateTime ?? `${ev.start?.date}T03:00:00Z`);
const endMs = (ev) => Date.parse(ev.end?.dateTime ?? `${ev.end?.date}T03:00:00Z`);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function read(req) {
  let raw = "";
  for await (const c of req) raw += c;
  return raw;
}
const jwt = (claims) => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

seed();

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  /* ---------- controle dos testes ---------- */
  if (p === "/__today") return send(res, 200, { today });
  if (req.method === "POST" && p === "/__reset") {
    seed();
    codes.clear();
    refresh.clear();
    access.clear();
    expired.clear();
    calls.length = 0;
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/__user") {
    nextUser = JSON.parse(await read(req)).user;
    return send(res, 200, { nextUser });
  }
  if (p === "/__calls") return send(res, 200, calls);
  if (p.startsWith("/__events/")) {
    const calId = decodeURIComponent(p.slice("/__events/".length));
    const cal = calendars.get(calId);
    if (!cal) return send(res, 404, {});
    if (req.method === "POST") return send(res, 200, pub(put(calId, JSON.parse(await read(req)))));
    return send(res, 200, [...cal.events.values()].map(pub));
  }
  if (req.method === "POST" && (p.startsWith("/__cancel/") || p.startsWith("/__touch/"))) {
    const [, , calId, evId] = p.split("/").map(decodeURIComponent);
    const cal = calendars.get(calId);
    if (!cal?.events.has(evId)) return send(res, 404, {});
    const body = p.startsWith("/__cancel/") ? { status: "cancelled" } : JSON.parse((await read(req)) || "{}");
    return send(res, 200, pub(put(calId, body, evId)));
  }
  if (req.method === "POST" && p.startsWith("/__expire/")) {
    expired.add(decodeURIComponent(p.slice("/__expire/".length)));
    return send(res, 200, {});
  }
  if (req.method === "POST" && p === "/__revoke-all") {
    for (const r of refresh.values()) r.revoked = true;
    access.clear();
    return send(res, 200, {});
  }

  /* ---------- OAuth ---------- */
  if (req.method === "GET" && p === "/o/oauth2/v2/auth") {
    const q = Object.fromEntries(url.searchParams);
    const ok =
      q.client_id === CLIENT_ID &&
      q.response_type === "code" &&
      q.code_challenge_method === "S256" &&
      q.code_challenge &&
      q.access_type === "offline" &&
      q.prompt === "consent" &&
      q.scope?.includes("https://www.googleapis.com/auth/calendar.events") &&
      q.redirect_uri?.endsWith("/api/google/callback");
    if (!ok) return send(res, 400, { error: "invalid_request" });
    const code = `code-${randomBytes(8).toString("hex")}`;
    codes.set(code, { challenge: q.code_challenge, redirect: q.redirect_uri, user: nextUser });
    const back = new URL(q.redirect_uri);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.state);
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }
  if (req.method === "POST" && p === "/token") {
    const f = Object.fromEntries(new URLSearchParams(await read(req)));
    if (f.client_id !== CLIENT_ID || f.client_secret !== CLIENT_SECRET) return send(res, 401, { error: "invalid_client" });
    if (f.grant_type === "authorization_code") {
      const c = codes.get(f.code);
      codes.delete(f.code);
      const challenge = f.code_verifier ? createHash("sha256").update(f.code_verifier).digest("base64url") : "";
      if (!c || c.redirect !== f.redirect_uri || challenge !== c.challenge) return send(res, 400, { error: "invalid_grant" });
      const u = USERS[c.user];
      const rt = `rt-${c.user}-${randomBytes(6).toString("hex")}`;
      const at = `at-${randomBytes(8).toString("hex")}`;
      refresh.set(rt, { user: c.user, revoked: false });
      access.set(at, c.user);
      const now = Math.floor(Date.now() / 1000);
      return send(res, 200, {
        access_token: at,
        expires_in: 3599,
        refresh_token: rt,
        scope: SCOPES,
        token_type: "Bearer",
        id_token: jwt({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: u.sub, email: u.email, email_verified: true, iat: now, exp: now + 3600 }),
      });
    }
    if (f.grant_type === "refresh_token") {
      const r = refresh.get(f.refresh_token);
      if (!r || r.revoked) return send(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      const at = `at-${randomBytes(8).toString("hex")}`;
      access.set(at, r.user);
      return send(res, 200, { access_token: at, expires_in: 3599, scope: SCOPES, token_type: "Bearer" });
    }
    return send(res, 400, { error: "unsupported_grant_type" });
  }
  if (req.method === "POST" && p === "/revoke") {
    const f = Object.fromEntries(new URLSearchParams(await read(req)));
    const r = refresh.get(f.token);
    if (!r) return send(res, 400, { error: "invalid_token" });
    r.revoked = true;
    return send(res, 200, {});
  }

  /* ---------- Calendar API ---------- */
  if (p.startsWith("/calendar/v3/")) {
    const user = access.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!user) return send(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
    calls.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), user });
    const rest = p.slice("/calendar/v3".length);

    if (rest === "/users/me/calendarList") {
      return send(res, 200, { items: [...calendars.values()].filter((c) => c.owner === user).map((c) => c.entry) });
    }
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(rest);
    if (!m) return send(res, 404, { error: { code: 404 } });
    const calId = decodeURIComponent(m[1]);
    const evId = m[2] ? decodeURIComponent(m[2]) : null;
    const cal = calendars.get(calId);
    if (!cal || cal.owner !== user) return send(res, 404, { error: { code: 404, message: "Not Found" } });
    const writable = ["owner", "writer"].includes(cal.entry.accessRole);

    if (req.method === "GET" && !evId) {
      const q = url.searchParams;
      const syncToken = q.get("syncToken");
      let list;
      if (syncToken) {
        // Doc: com syncToken não pode haver timeMin/timeMax/orderBy/q/updatedMin/iCalUID/…ExtendedProperty.
        for (const bad of ["timeMin", "timeMax", "orderBy", "q", "updatedMin", "iCalUID", "privateExtendedProperty", "sharedExtendedProperty"]) {
          if (q.has(bad)) return send(res, 400, { error: { code: 400, message: `${bad} incompatível com syncToken` } });
        }
        if (expired.has(calId)) {
          expired.delete(calId);
          return send(res, 410, { error: { code: 410, message: "Sync token is no longer valid, a full sync is required." } });
        }
        const since = Number(syncToken.split("-").pop());
        list = [...cal.events.values()].filter((e) => e.v > since); // inclui cancelados
      } else {
        const min = Date.parse(q.get("timeMin") ?? "1970-01-01T00:00:00Z");
        const max = Date.parse(q.get("timeMax") ?? "2999-01-01T00:00:00Z");
        list = [...cal.events.values()].filter((e) => e.status !== "cancelled" && endMs(e) > min && startMs(e) < max);
      }
      // Páginas de 2 itens para exercitar o pageToken.
      const start = Number(q.get("pageToken") ?? 0);
      const page = list.slice(start, start + 2);
      const more = start + 2 < list.length;
      return send(res, 200, {
        kind: "calendar#events",
        items: page.map(pub),
        ...(more ? { nextPageToken: String(start + 2) } : { nextSyncToken: `st-${version}` }),
      });
    }
    if (req.method === "POST" && !evId) {
      if (!writable) return send(res, 403, { error: { code: 403 } });
      const body = JSON.parse(await read(req));
      if (!body.summary || !body.start || !body.end) return send(res, 400, { error: { code: 400 } });
      return send(res, 200, pub(put(calId, body)));
    }
    const ev = evId ? cal.events.get(evId) : null;
    if (!ev || (ev.status === "cancelled" && req.method !== "GET")) return send(res, ev ? 410 : 404, { error: { code: ev ? 410 : 404 } });
    if (req.method === "GET") return send(res, 200, pub(ev));
    if (!writable) return send(res, 403, { error: { code: 403 } });
    const ifMatch = req.headers["if-match"];
    if (ifMatch && ifMatch !== ev.etag) return send(res, 412, { error: { code: 412, message: "Precondition Failed" } });
    if (req.method === "PATCH") return send(res, 200, pub(put(calId, JSON.parse(await read(req)), evId)));
    if (req.method === "DELETE") {
      put(calId, { status: "cancelled" }, evId);
      return send(res, 204);
    }
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`google mock on ${PORT}`));
