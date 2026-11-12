import "server-only";
import { driveEndpoints, DRIVE_SCOPE, hasScope } from "./config";
import { GoogleApiError } from "./api";

/**
 * Google Drive API v3 (REST, sempre do servidor), genérica para os módulos (hoje: Carisma).
 * Escopo drive.file: o app só enxerga o que ele mesmo criou. Tokens nunca vão para log.
 * Referências (developers.google.com/workspace/drive/api, conferidas em 12/11/2026):
 * - guides/manage-uploads: upload resumível = POST /upload/drive/v3/files?uploadType=resumable com os metadados;
 *   a resposta traz o "resumable session URI" no header Location (vale 1 semana); depois um PUT com o conteúdo.
 * - reference/rest/v3/files/generateIds: IDs gerados antes, aceitos no create (escopo drive.file serve).
 * - guides/folder: pasta = mimeType application/vnd.google-apps.folder; `parents` liga o arquivo à pasta.
 * - guides/manage-downloads: files.get com alt=media; aceita o header Range (download parcial).
 * - reference/rest/v3/permissions/create: sendNotificationEmail=false (padrão é true para usuário).
 * - guides/delete: lixeira = files.update com {"trashed": true} (o Drive apaga de vez depois de 30 dias).
 * Header Origin no início da sessão: a doc do Cloud Storage (performing-resumable-uploads) manda incluir o Origin
 * do navegador no pedido inicial quando o envio continua no navegador (CORS); a doc do Drive não fala do assunto.
 */
export class DriveApiError extends GoogleApiError {}

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const TIMEOUT_MS = 20_000;

export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
  appProperties?: Record<string, string>;
};

type CallOpts = { body?: unknown; headers?: Record<string, string>; base?: "api" | "upload" };

async function request(token: string, method: string, path: string, opts: CallOpts = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8";
  const ep = driveEndpoints();
  return fetch(`${opts.base === "upload" ? ep.upload : ep.api}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

async function call<T>(token: string, method: string, path: string, opts: CallOpts = {}): Promise<T> {
  const res = await request(token, method, path, opts);
  if (res.status === 204) return null as T;
  if (!res.ok) throw new DriveApiError(`Google Drive respondeu ${res.status}.`, res.status);
  return (await res.json()) as T;
}

const enc = encodeURIComponent;
const FILE_FIELDS = "id,name,mimeType,size,parents,trashed,webViewLink,appProperties";

/* ---------- Arquivos ---------- */

/** Um ID novo para usar no create (assim o app já sabe o ID antes de o navegador terminar o upload). */
export async function generateFileId(token: string) {
  const r = await call<{ ids?: string[] }>(token, "GET", "/files/generateIds?count=1&space=drive&type=files");
  const id = r?.ids?.[0];
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new DriveApiError("ID inválido do Drive.", 502);
  return id;
}

/** Metadados; 404 (não existe ou o app não tem acesso) → null. */
export async function getFile(token: string, id: string): Promise<DriveFile | null> {
  try {
    return await call<DriveFile>(token, "GET", `/files/${enc(id)}?fields=${enc(FILE_FIELDS)}`);
  } catch (e) {
    if (e instanceof DriveApiError && e.status === 404) return null;
    throw e;
  }
}

export async function createFolder(token: string, name: string, parentId: string | null, appProperties?: Record<string, string>) {
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  if (appProperties) body.appProperties = appProperties;
  const f = await call<DriveFile>(token, "POST", `/files?fields=${enc("id")}`, { body });
  if (!f?.id) throw new DriveApiError("Pasta sem ID.", 502);
  return f.id;
}

/** Move para a lixeira (não apaga de vez). Já sumiu (404) conta como feito. */
export async function trashFile(token: string, id: string) {
  try {
    await call<DriveFile>(token, "PATCH", `/files/${enc(id)}?fields=${enc("id,trashed")}`, { body: { trashed: true } });
  } catch (e) {
    if (e instanceof DriveApiError && e.status === 404) return;
    throw e;
  }
}

/** Renomeia (só o campo name). 404 sobe como erro: o arquivo sumiu do Drive ou o app perdeu o acesso. */
export async function renameFile(token: string, id: string, name: string) {
  await call<DriveFile>(token, "PATCH", `/files/${enc(id)}?fields=${enc("id,name")}`, { body: { name } });
}

/* ---------- Upload resumível ---------- */

export type ResumableInput = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  parentId: string;
  appProperties?: Record<string, string>;
  /** Origem do app (ex.: https://oliveiras.vercel.app), para o Google responder com CORS ao PUT do navegador. */
  origin: string;
};

/**
 * Cria a sessão de upload resumível no Drive com o token do dono e devolve o session URI (Location).
 * O URI só é aceito se for do endpoint de upload configurado (nunca repassa outro host ao navegador).
 */
export async function startResumableUpload(token: string, input: ResumableInput) {
  const body: Record<string, unknown> = { id: input.id, name: input.name, mimeType: input.mimeType, parents: [input.parentId] };
  if (input.appProperties) body.appProperties = input.appProperties;
  const res = await request(token, "POST", "/files?uploadType=resumable", {
    base: "upload",
    body,
    headers: { "X-Upload-Content-Type": input.mimeType, "X-Upload-Content-Length": String(input.size), Origin: input.origin },
  });
  if (!res.ok) throw new DriveApiError(`Google Drive respondeu ${res.status}.`, res.status);
  const location = res.headers.get("location") ?? "";
  if (!isSessionUri(location)) throw new DriveApiError("Sessão de upload inválida.", 502);
  return location;
}

/** Session URI do endpoint de upload configurado, com upload_id. */
export function isSessionUri(v: string, env?: Record<string, string | undefined>) {
  const base = driveEndpoints(env).upload;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  const b = new URL(base);
  return u.origin === b.origin && u.pathname === `${b.pathname.replace(/\/+$/, "")}/files` && u.searchParams.has("upload_id") && !u.username;
}

/* ---------- Download ---------- */

/** Bytes [start, end] (inclusivos) com o header Range. Lê no máximo end-start+1 bytes, mesmo se o servidor mandar tudo. */
export async function downloadRange(token: string, id: string, start: number, end: number) {
  const res = await request(token, "GET", `/files/${enc(id)}?alt=media`, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new DriveApiError(`Google Drive respondeu ${res.status}.`, res.status);
  return readCapped(res, end - start + 1, false);
}

/** Conteúdo inteiro, recusando acima de `maxBytes`. */
export async function downloadFile(token: string, id: string, maxBytes: number) {
  const res = await request(token, "GET", `/files/${enc(id)}?alt=media`);
  if (!res.ok) throw new DriveApiError(`Google Drive respondeu ${res.status}.`, res.status);
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new DriveApiError("Arquivo grande demais.", 413);
  }
  return readCapped(res, maxBytes, true);
}

async function readCapped(res: Response, max: number, failOnOverflow: boolean) {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      if (failOnOverflow) throw new DriveApiError("Arquivo grande demais.", 413);
      chunks.push(value.subarray(0, value.length - (total - max)));
      total = max;
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* ---------- Permissões ---------- */

type Permission = { id: string; type?: string; role?: string; emailAddress?: string };

export async function listPermissions(token: string, fileId: string) {
  const r = await call<{ permissions?: Permission[] }>(token, "GET", `/files/${enc(fileId)}/permissions?fields=${enc("permissions(id,type,role,emailAddress)")}`);
  return r?.permissions ?? [];
}

/** Leitura para um e-mail, SEM e-mail de notificação. Já tem acesso → não duplica. */
export async function grantReader(token: string, fileId: string, email: string) {
  const target = email.trim().toLowerCase();
  const existing = (await listPermissions(token, fileId)).find((p) => p.type === "user" && p.emailAddress?.toLowerCase() === target);
  if (existing) return existing.id;
  const p = await call<Permission>(token, "POST", `/files/${enc(fileId)}/permissions?sendNotificationEmail=false&fields=id`, {
    body: { type: "user", role: "reader", emailAddress: target },
  });
  return p.id;
}

/** Remove as permissões de leitura deste e-mail (nunca a do dono). Devolve quantas saíram. */
export async function revokeReader(token: string, fileId: string, email: string) {
  const target = email.trim().toLowerCase();
  const perms = (await listPermissions(token, fileId)).filter((p) => p.type === "user" && p.role !== "owner" && p.emailAddress?.toLowerCase() === target);
  for (const p of perms) {
    try {
      await call<null>(token, "DELETE", `/files/${enc(fileId)}/permissions/${enc(p.id)}`);
    } catch (e) {
      if (!(e instanceof DriveApiError && e.status === 404)) throw e;
    }
  }
  return perms.length;
}

/**
 * Remove TODAS as permissões que não sejam do dono (não depende de quais contas o cônjuge tem hoje:
 * conta desconectada, revogada ou com outro e-mail também perde o acesso). Devolve quantas saíram.
 */
export async function revokeAllButOwner(token: string, fileId: string) {
  const perms = (await listPermissions(token, fileId)).filter((p) => p.role !== "owner");
  for (const p of perms) {
    try {
      await call<null>(token, "DELETE", `/files/${enc(fileId)}/permissions/${enc(p.id)}`);
    } catch (e) {
      if (!(e instanceof DriveApiError && e.status === 404)) throw e;
    }
  }
  return perms.length;
}

/* ---------- Pastas do app (cache) ---------- */

/** Onde o ID de uma pasta fica guardado (google_drive_folders, ou a coluna drive_folder_id da aula). */
export type FolderCache = { get(): Promise<string | null>; set(folderId: string): Promise<void> };

/**
 * Pasta garantida: usa o ID guardado se ainda existe no Drive (pasta, fora da lixeira e com o pai certo);
 * senão cria de novo e guarda. Devolve { id, created }.
 */
export async function ensureFolder(token: string, cache: FolderCache, name: string, parentId: string | null) {
  const cached = await cache.get();
  if (cached) {
    const f = await getFile(token, cached);
    if (f && !f.trashed && f.mimeType === FOLDER_MIME && (!parentId || (f.parents ?? []).includes(parentId))) return { id: cached, created: false };
  }
  const id = await createFolder(token, name, parentId);
  await cache.set(id);
  return { id, created: true };
}

/* ---------- Conta ---------- */

export type DriveAccess = "sem-conta" | "revogado" | "sem-drive" | "ok";

/** Situação do Drive para as contas Google de UMA pessoa (coluna scopes). */
export function driveAccessOf(accounts: { status: string; scopes: string | null }[]): DriveAccess {
  if (!accounts.length) return "sem-conta";
  const active = accounts.filter((a) => a.status !== "revogado");
  if (!active.length) return "revogado";
  return active.some((a) => hasScope(a.scopes, DRIVE_SCOPE)) ? "ok" : "sem-drive";
}

/** Conta escolhida para o Drive: a primeira ativa com drive.file (status 'ok' antes de 'erro'). */
export function pickDriveAccount<T extends { status: string; scopes: string | null }>(accounts: T[]): T | null {
  const withDrive = accounts.filter((a) => a.status !== "revogado" && hasScope(a.scopes, DRIVE_SCOPE));
  return withDrive.find((a) => a.status === "ok") ?? withDrive[0] ?? null;
}

/** Mensagem amigável para falhas do Drive (sem detalhes técnicos). */
export function driveErrorMessage(e: unknown) {
  if (e instanceof DriveApiError) {
    if (e.status === 401 || e.status === 403) return "O Google Drive recusou o acesso. Reconecte o Google Drive e tente de novo.";
    if (e.status === 404) return "O arquivo ou a pasta não existe mais no Google Drive.";
    if (e.status === 413) return "O arquivo passa de 20 MB.";
  }
  return "Não foi possível falar com o Google Drive agora. Tente de novo.";
}
