// Google Drive API v3 simulado nos testes E2E (Carisma). Nunca usado em produção.
// Tokens: confere no google-mock (/__whoami) de quem é o token e se tem o escopo drive.file (sem ele: 403).
// API: /drive/v3/files/generateIds, POST /drive/v3/files (pasta), GET /drive/v3/files/:id (metadados ou alt=media com Range),
//      PATCH /drive/v3/files/:id (trashed, name), /drive/v3/files/:id/permissions (GET, POST com sendNotificationEmail, DELETE).
// Upload resumível: POST /upload/drive/v3/files?uploadType=resumable (exige o header Origin) → Location com upload_id;
//      OPTIONS/PUT no session URI com CORS para a origem que iniciou a sessão (o navegador envia direto).
// Controle dos testes: GET /__files (tudo, com permissões e lixeira).
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.DRIVE_MOCK_PORT ?? 4040);
const GOOGLE = process.env.GOOGLE_MOCK_URL ?? "http://127.0.0.1:4020";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER = "application/vnd.google-apps.folder";

const files = new Map(); // id → { id, name, mimeType, parents, appProperties, trashed, owner, ownerEmail, content, permissions }
const sessions = new Map(); // upload_id → { meta, owner, ownerEmail, origin, size }
const issued = new Set(); // ids de generateIds ainda não usados
const newId = () => randomBytes(12).toString("base64url").replace(/[^A-Za-z0-9_-]/g, "");

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function readBuf(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
async function whoami(req) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!token) return null;
  const r = await fetch(`${GOOGLE}/__whoami?token=${encodeURIComponent(token)}`);
  return r.ok ? r.json() : null;
}
const pick = (f, fields) => {
  const all = {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    trashed: f.trashed,
    appProperties: f.appProperties,
    ...(f.mimeType === FOLDER ? {} : { size: String(f.content?.length ?? 0) }),
    webViewLink: f.mimeType === FOLDER ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`,
  };
  if (!fields) return { id: f.id, name: f.name, mimeType: f.mimeType };
  const keys = fields.split(",").map((k) => k.trim());
  return Object.fromEntries(Object.entries(all).filter(([k]) => keys.includes(k)));
};
const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, content-range",
  "Access-Control-Expose-Headers": "range",
  Vary: "Origin",
});

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  if (p === "/__files") {
    return send(
      res,
      200,
      [...files.values()].map((f) => ({ ...pick(f, "id,name,mimeType,parents,trashed,appProperties,size"), owner: f.ownerEmail, permissions: f.permissions })),
    );
  }

  /* ---------- Sessão de upload (navegador) ---------- */
  if (p === "/upload/drive/v3/files" && url.searchParams.has("upload_id")) {
    const s = sessions.get(url.searchParams.get("upload_id"));
    if (!s) return send(res, 404, { error: { code: 404 } });
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors(s.origin));
      return res.end();
    }
    if (req.method !== "PUT") return send(res, 405, {}, cors(s.origin));
    if (req.headers.origin && req.headers.origin !== s.origin) return send(res, 403, { error: { code: 403 } });
    const content = await readBuf(req);
    if (s.size && content.length !== s.size) return send(res, 400, { error: { code: 400, message: "tamanho diferente" } }, cors(s.origin));
    const f = { ...s.meta, trashed: false, owner: s.owner, ownerEmail: s.ownerEmail, content, permissions: [{ id: `p-${newId()}`, type: "user", role: "owner", emailAddress: s.ownerEmail }] };
    files.set(f.id, f);
    sessions.delete(url.searchParams.get("upload_id"));
    return send(res, 200, pick(f, "id,name,mimeType"), cors(s.origin));
  }

  /* ---------- Chamadas autenticadas (servidor do app) ---------- */
  const who = await whoami(req);
  if (!who) return send(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
  if (!who.scopes.split(/\s+/).includes(DRIVE_SCOPE)) return send(res, 403, { error: { code: 403, message: "insufficientPermissions" } });
  const mine = (id) => {
    const f = files.get(id);
    return f && f.owner === who.user ? f : null;
  };

  if (req.method === "POST" && p === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable") {
    const origin = req.headers.origin;
    if (!origin) return send(res, 400, { error: { code: 400, message: "sem Origin: o navegador não teria CORS" } });
    const meta = JSON.parse((await readBuf(req)).toString("utf8") || "{}");
    if (!meta.id || !issued.has(meta.id)) return send(res, 400, { error: { code: 400, message: "id não gerado" } });
    if (!meta.parents?.length || !mine(meta.parents[0])) return send(res, 404, { error: { code: 404, message: "pasta" } });
    issued.delete(meta.id);
    const uploadId = newId();
    sessions.set(uploadId, {
      meta: { id: meta.id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, appProperties: meta.appProperties ?? {} },
      owner: who.user,
      ownerEmail: who.email,
      origin,
      size: Number(req.headers["x-upload-content-length"] ?? 0),
    });
    res.writeHead(200, { Location: `http://127.0.0.1:${PORT}/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}`, "Content-Length": "0" });
    return res.end();
  }

  if (!p.startsWith("/drive/v3/")) return send(res, 404, { error: { code: 404 } });
  const rest = p.slice("/drive/v3".length);

  if (req.method === "GET" && rest === "/files/generateIds") {
    const id = newId();
    issued.add(id);
    return send(res, 200, { kind: "drive#generatedIds", space: "drive", ids: [id] });
  }
  if (req.method === "POST" && rest === "/files") {
    const body = JSON.parse((await readBuf(req)).toString("utf8") || "{}");
    if (body.mimeType !== FOLDER || !body.name) return send(res, 400, { error: { code: 400 } });
    if (body.parents?.length && !mine(body.parents[0])) return send(res, 404, { error: { code: 404 } });
    const f = { id: newId(), name: body.name, mimeType: FOLDER, parents: body.parents ?? [], appProperties: body.appProperties ?? {}, trashed: false, owner: who.user, ownerEmail: who.email, content: null, permissions: [{ id: `p-${newId()}`, type: "user", role: "owner", emailAddress: who.email }] };
    files.set(f.id, f);
    return send(res, 200, pick(f, url.searchParams.get("fields") ?? "id"));
  }

  const perm = /^\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/.exec(rest);
  if (perm) {
    const f = mine(decodeURIComponent(perm[1]));
    if (!f) return send(res, 404, { error: { code: 404 } });
    if (req.method === "GET" && !perm[2]) return send(res, 200, { permissions: f.permissions });
    if (req.method === "POST" && !perm[2]) {
      if (url.searchParams.get("sendNotificationEmail") !== "false") return send(res, 400, { error: { code: 400, message: "esperava sendNotificationEmail=false" } });
      const body = JSON.parse((await readBuf(req)).toString("utf8") || "{}");
      if (body.type !== "user" || body.role !== "reader" || !body.emailAddress) return send(res, 400, { error: { code: 400 } });
      const np = { id: `p-${newId()}`, type: "user", role: "reader", emailAddress: body.emailAddress };
      f.permissions.push(np);
      return send(res, 200, { id: np.id });
    }
    if (req.method === "DELETE" && perm[2]) {
      const before = f.permissions.length;
      f.permissions = f.permissions.filter((x) => x.id !== decodeURIComponent(perm[2]) || x.role === "owner");
      return send(res, before === f.permissions.length ? 404 : 204);
    }
    return send(res, 405, {});
  }

  const fm = /^\/files\/([^/]+)$/.exec(rest);
  if (fm) {
    const f = mine(decodeURIComponent(fm[1]));
    if (!f) return send(res, 404, { error: { code: 404, message: "File not found" } });
    if (req.method === "GET" && url.searchParams.get("alt") === "media") {
      const buf = f.content ?? Buffer.alloc(0);
      const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
      if (m) {
        const start = Number(m[1]);
        const end = Math.min(Number(m[2]), buf.length - 1);
        res.writeHead(206, { "Content-Type": f.mimeType, "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Content-Length": String(end - start + 1) });
        return res.end(buf.subarray(start, end + 1));
      }
      res.writeHead(200, { "Content-Type": f.mimeType, "Content-Length": String(buf.length) });
      return res.end(buf);
    }
    if (req.method === "GET") return send(res, 200, pick(f, url.searchParams.get("fields")));
    if (req.method === "PATCH") {
      const body = JSON.parse((await readBuf(req)).toString("utf8") || "{}");
      if (typeof body.trashed === "boolean") {
        f.trashed = body.trashed;
        // Pasta na lixeira leva os filhos junto.
        if (f.mimeType === FOLDER) for (const c of files.values()) if (c.parents?.includes(f.id)) c.trashed = body.trashed;
      }
      if (typeof body.name === "string") f.name = body.name;
      return send(res, 200, pick(f, url.searchParams.get("fields") ?? "id,trashed"));
    }
  }
  send(res, 404, { error: { code: 404 } });
}).listen(PORT, "127.0.0.1", () => console.log(`drive-mock em ${PORT}`));
