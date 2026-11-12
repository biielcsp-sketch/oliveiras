import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  downloadFile,
  downloadRange,
  driveAccessOf,
  driveErrorMessage,
  DriveApiError,
  ensureFolder,
  FOLDER_MIME,
  generateFileId,
  getFile,
  grantReader,
  isSessionUri,
  pickDriveAccount,
  revokeAllButOwner,
  revokeReader,
  startResumableUpload,
  trashFile,
} from "@/lib/google/drive";
import { DRIVE_SCOPE, driveEndpoints, GOOGLE_SCOPES, hasScope, REQUIRED_SCOPES } from "@/lib/google/config";
import { GoogleApiError } from "@/lib/google/api";
import { buildAuthUrl, decodeState, encodeState, newOAuthState } from "@/lib/google/oauth";
import { carismaAllowedFor } from "@/lib/family-access";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let replies: Response[];

function reply(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? null : body instanceof Uint8Array ? body : JSON.stringify(body);
  return new Response(payload as BodyInit | null, { status, headers });
}

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const r = replies.shift();
      if (!r) throw new Error(`sem resposta para ${url}`);
      return r;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

describe("endpoints e escopo do Drive", () => {
  it("padrão é a Drive API v3; base de teste só em localhost", () => {
    expect(driveEndpoints({})).toEqual({ api: API, upload: UPLOAD });
    expect(driveEndpoints({ GOOGLE_DRIVE_API_BASE: "http://127.0.0.1:4040/drive/v3", GOOGLE_DRIVE_UPLOAD_BASE: "http://127.0.0.1:4040/upload/drive/v3" })).toEqual({
      api: "http://127.0.0.1:4040/drive/v3",
      upload: "http://127.0.0.1:4040/upload/drive/v3",
    });
    expect(() => driveEndpoints({ GOOGLE_DRIVE_API_BASE: "https://evil.example.com/drive/v3" })).toThrow();
  });
  it("drive.file é opcional: fora dos escopos padrão e dos obrigatórios da Agenda", () => {
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect(GOOGLE_SCOPES as readonly string[]).not.toContain(DRIVE_SCOPE);
    expect(REQUIRED_SCOPES as readonly string[]).not.toContain(DRIVE_SCOPE);
    expect(hasScope(`openid ${DRIVE_SCOPE}`, DRIVE_SCOPE)).toBe(true);
    expect(hasScope("openid https://www.googleapis.com/auth/drive.file.x", DRIVE_SCOPE)).toBe(false);
    expect(hasScope(null, DRIVE_SCOPE)).toBe(false);
  });
  it("consentimento do Carisma pede drive.file junto com os da Agenda, incremental (include_granted_scopes)", () => {
    const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" };
    const agenda = new URL(buildAuthUrl(newOAuthState("u1"), "https://app/api/google/callback", env));
    expect(agenda.searchParams.get("scope")).not.toContain("drive");
    const s = newOAuthState("u1", Date.now(), { drive: true });
    const url = new URL(buildAuthUrl(s, "https://app/api/google/callback", env));
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([...GOOGLE_SCOPES, DRIVE_SCOPE]);
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(decodeState(encodeState(s))?.drive).toBe(true);
    expect(decodeState(encodeState(newOAuthState("u1")))?.drive).toBeUndefined();
    expect(decodeState(Buffer.from(JSON.stringify({ state: "a", verifier: "b", uid: "c", exp: 1, drive: "sim" })).toString("base64url"))).toBeNull();
  });
  it("situação do Drive pela coluna scopes; escolhe conta ativa com drive.file", () => {
    expect(driveAccessOf([])).toBe("sem-conta");
    expect(driveAccessOf([{ status: "revogado", scopes: DRIVE_SCOPE }])).toBe("revogado");
    expect(driveAccessOf([{ status: "ok", scopes: "openid" }])).toBe("sem-drive");
    expect(driveAccessOf([{ status: "erro", scopes: `openid ${DRIVE_SCOPE}` }])).toBe("ok");
    const a = { id: "a", status: "erro", scopes: DRIVE_SCOPE };
    const b = { id: "b", status: "ok", scopes: DRIVE_SCOPE };
    expect(pickDriveAccount([{ id: "c", status: "ok", scopes: "openid" }, a, b])?.id).toBe("b");
    expect(pickDriveAccount([{ id: "c", status: "ok", scopes: "openid" }])).toBeNull();
  });
  it("Carisma: CARISMA_HOUSEHOLD_ID → OLI_HOUSEHOLD_ID → PLUGGY_HOUSEHOLD_ID", () => {
    expect(carismaAllowedFor("h1", { CARISMA_HOUSEHOLD_ID: "h1", OLI_HOUSEHOLD_ID: "h2" })).toBe(true);
    expect(carismaAllowedFor("h2", { CARISMA_HOUSEHOLD_ID: "h1", OLI_HOUSEHOLD_ID: "h2" })).toBe(false);
    expect(carismaAllowedFor("h2", { CARISMA_HOUSEHOLD_ID: " ", OLI_HOUSEHOLD_ID: "h2" })).toBe(true);
    expect(carismaAllowedFor("h3", { PLUGGY_HOUSEHOLD_ID: "h3" })).toBe(true);
    expect(carismaAllowedFor("h3", {})).toBe(false);
  });
});

describe("arquivos", () => {
  it("generateIds devolve um ID válido; resposta estranha é recusada", async () => {
    replies.push(reply(200, { ids: ["abc_123-X"] }));
    expect(await generateFileId("tok")).toBe("abc_123-X");
    expect(calls[0]).toMatchObject({ url: `${API}/files/generateIds?count=1&space=drive&type=files`, method: "GET" });
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    replies.push(reply(200, { ids: ["../x"] }));
    await expect(generateFileId("tok")).rejects.toBeInstanceOf(DriveApiError);
  });
  it("getFile pede os campos usados e devolve null no 404; outros erros sobem com status", async () => {
    replies.push(reply(200, { id: "f1", size: "10" }), reply(404, {}), reply(500, {}));
    expect(await getFile("t", "f1")).toEqual({ id: "f1", size: "10" });
    expect(decodeURIComponent(calls[0].url)).toBe(`${API}/files/f1?fields=id,name,mimeType,size,parents,trashed,webViewLink,appProperties`);
    expect(await getFile("t", "f2")).toBeNull();
    const err = await getFile("t", "f3").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError); // o withToken da Agenda renova no 401 porque DriveApiError é GoogleApiError
    expect(err.status).toBe(500);
  });
  it("lixeira = PATCH trashed:true (não apaga de vez); 404 conta como feito", async () => {
    replies.push(reply(200, { id: "f1", trashed: true }), reply(404, {}));
    await trashFile("t", "f1");
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { trashed: true } });
    expect(calls[0].url.startsWith(`${API}/files/f1?`)).toBe(true);
    await expect(trashFile("t", "sumiu")).resolves.toBeUndefined();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

describe("pastas do app", () => {
  const cache = (initial: string | null) => {
    let v = initial;
    return { get: vi.fn(async () => v), set: vi.fn(async (id: string) => void (v = id)), now: () => v };
  };
  it("usa a pasta guardada se ainda existe com o pai certo", async () => {
    const c = cache("pasta1");
    replies.push(reply(200, { id: "pasta1", mimeType: FOLDER_MIME, trashed: false, parents: ["pai"] }));
    expect(await ensureFolder("t", c, "Carisma", "pai")).toEqual({ id: "pasta1", created: false });
    expect(calls).toHaveLength(1);
    expect(c.set).not.toHaveBeenCalled();
  });
  it("pasta na lixeira ou apagada no Drive é recriada e o cache atualizado", async () => {
    const c = cache("velha");
    replies.push(reply(200, { id: "velha", mimeType: FOLDER_MIME, trashed: true, parents: ["pai"] }), reply(200, { id: "nova" }));
    expect(await ensureFolder("t", c, "Carisma", "pai")).toEqual({ id: "nova", created: true });
    expect(calls[1]).toMatchObject({ method: "POST", body: { name: "Carisma", mimeType: FOLDER_MIME, parents: ["pai"] } });
    expect(c.now()).toBe("nova");
    const gone = cache("apagada");
    replies.push(reply(404, {}), reply(200, { id: "outra" }));
    expect((await ensureFolder("t", gone, "Oliveira's", null)).id).toBe("outra");
    expect(calls[3].body).toEqual({ name: "Oliveira's", mimeType: FOLDER_MIME });
  });
  it("sem cache cria direto", async () => {
    const c = cache(null);
    replies.push(reply(200, { id: "p" }));
    expect(await ensureFolder("t", c, "Aula", "carisma")).toEqual({ id: "p", created: true });
  });
});

describe("upload resumível", () => {
  const input = { id: "fid", name: "aula.pdf", mimeType: "application/pdf", size: 1234, parentId: "pasta", appProperties: { oliFile: "row" }, origin: "https://oliveiras.app" };
  it("inicia no endpoint de upload com metadados, Origin e X-Upload-*; devolve o session URI", async () => {
    const session = `${UPLOAD}/files?uploadType=resumable&upload_id=xa298`;
    replies.push(reply(200, undefined, { Location: session }));
    expect(await startResumableUpload("tok", input)).toBe(session);
    const c = calls[0];
    expect(c.url).toBe(`${UPLOAD}/files?uploadType=resumable`);
    expect(c.method).toBe("POST");
    expect(c.headers).toMatchObject({
      Authorization: "Bearer tok",
      Origin: "https://oliveiras.app",
      "X-Upload-Content-Type": "application/pdf",
      "X-Upload-Content-Length": "1234",
      "Content-Type": "application/json; charset=UTF-8",
    });
    expect(c.body).toEqual({ id: "fid", name: "aula.pdf", mimeType: "application/pdf", parents: ["pasta"], appProperties: { oliFile: "row" } });
  });
  it("recusa Location de outro host ou sem upload_id (nunca repassa ao navegador)", async () => {
    replies.push(reply(200, undefined, { Location: "https://evil.example.com/upload/drive/v3/files?upload_id=x" }));
    await expect(startResumableUpload("t", input)).rejects.toBeInstanceOf(DriveApiError);
    replies.push(reply(200, undefined, { Location: `${UPLOAD}/files?uploadType=resumable` }));
    await expect(startResumableUpload("t", input)).rejects.toBeInstanceOf(DriveApiError);
    replies.push(reply(403, {}));
    await expect(startResumableUpload("t", input)).rejects.toMatchObject({ status: 403 });
    expect(isSessionUri(`${UPLOAD}/files?upload_id=abc`, {})).toBe(true);
    expect(isSessionUri(`${UPLOAD}/files/../x?upload_id=abc`, {})).toBe(false);
  });
});

describe("download", () => {
  it("primeiros bytes com Range e no máximo o pedido, mesmo se o servidor mandar tudo", async () => {
    replies.push(reply(200, new TextEncoder().encode("%PDF-1.4 conteúdo longo")));
    const head = await downloadRange("t", "f1", 0, 4);
    expect(new TextDecoder().decode(head)).toBe("%PDF-");
    expect(calls[0].url).toBe(`${API}/files/f1?alt=media`);
    expect(calls[0].headers.Range).toBe("bytes=0-4");
  });
  it("arquivo inteiro recusa acima do limite (Content-Length ou corpo)", async () => {
    replies.push(reply(200, new Uint8Array(11), { "Content-Length": "11" }));
    await expect(downloadFile("t", "f", 10)).rejects.toMatchObject({ status: 413 });
    replies.push(reply(200, new Uint8Array(5)));
    expect((await downloadFile("t", "f", 10)).length).toBe(5);
    expect(driveErrorMessage(new DriveApiError("x", 413))).toBe("O arquivo passa de 20 MB.");
    expect(driveErrorMessage(new DriveApiError("x", 403))).toContain("Reconecte o Google Drive");
    expect(driveErrorMessage(new Error("x"))).toContain("Tente de novo");
  });
});

describe("permissões", () => {
  it("leitura para o e-mail do cônjuge sem e-mail de notificação; não duplica", async () => {
    replies.push(reply(200, { permissions: [{ id: "own", type: "user", role: "owner", emailAddress: "gabriel@gmail.com" }] }), reply(200, { id: "p1" }));
    expect(await grantReader("t", "pasta", " Karen@Gmail.com ")).toBe("p1");
    expect(calls[1].url).toBe(`${API}/files/pasta/permissions?sendNotificationEmail=false&fields=id`);
    expect(calls[1]).toMatchObject({ method: "POST", body: { type: "user", role: "reader", emailAddress: "karen@gmail.com" } });
    replies.push(reply(200, { permissions: [{ id: "p1", type: "user", role: "reader", emailAddress: "karen@gmail.com" }] }));
    expect(await grantReader("t", "pasta", "karen@gmail.com")).toBe("p1");
    expect(calls).toHaveLength(3);
  });
  it("remove só as permissões do e-mail (nunca a do dono)", async () => {
    replies.push(
      reply(200, {
        permissions: [
          { id: "own", type: "user", role: "owner", emailAddress: "karen@gmail.com" },
          { id: "p1", type: "user", role: "reader", emailAddress: "karen@gmail.com" },
          { id: "p2", type: "user", role: "reader", emailAddress: "outra@gmail.com" },
        ],
      }),
      reply(204),
    );
    expect(await revokeReader("t", "pasta", "KAREN@gmail.com")).toBe(1);
    expect(calls[1]).toMatchObject({ method: "DELETE", url: `${API}/files/pasta/permissions/p1` });
  });
  it("descompartilhar tira TODAS as permissões que não são do dono (conta antiga do cônjuge também)", async () => {
    replies.push(
      reply(200, {
        permissions: [
          { id: "own", type: "user", role: "owner", emailAddress: "gabriel@gmail.com" },
          { id: "velha", type: "user", role: "reader", emailAddress: "karen.antiga@gmail.com" },
          { id: "nova", type: "user", role: "reader", emailAddress: "karen@gmail.com" },
        ],
      }),
      reply(204),
      reply(404, {}),
    );
    expect(await revokeAllButOwner("t", "pasta")).toBe(2);
    expect(calls.slice(1).map((c) => [c.method, c.url])).toEqual([
      ["DELETE", `${API}/files/pasta/permissions/velha`],
      ["DELETE", `${API}/files/pasta/permissions/nova`],
    ]);
    replies.push(reply(200, { permissions: [{ id: "x", role: "reader" }] }), reply(500, {}));
    await expect(revokeAllButOwner("t", "pasta")).rejects.toMatchObject({ status: 500 });
  });
  it("Drive sem o escopo (403) sobe como erro com status para a tela pedir reconexão", async () => {
    replies.push(reply(403, { error: { message: "insufficientPermissions" } }));
    const e = await grantReader("t", "pasta", "k@gmail.com").catch((x) => x);
    expect(e).toBeInstanceOf(DriveApiError);
    expect(e.status).toBe(403);
  });
});
