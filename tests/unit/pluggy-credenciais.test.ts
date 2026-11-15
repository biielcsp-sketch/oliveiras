import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { configuredCredentials, parseCredential } from "@/lib/pluggy/credentials";
import { PluggyError, pluggyErrorLog, pluggyErrorMessage } from "@/lib/pluggy/errors";
import { getItem, listAccounts, pluggyConfigured, pluggyCredentials, resetPluggyKeyCache } from "@/lib/pluggy/client";

const ITEM = "11111111-1111-4111-8111-111111111111";
const ENV = {
  PLUGGY_CLIENT_ID: "id-g", PLUGGY_CLIENT_SECRET: "sec-g",
  PLUGGY_CLIENT_ID_KAREN: "id-k", PLUGGY_CLIENT_SECRET_KAREN: "sec-k",
};

type Call = { url: string; key?: string; body?: { clientId: string } };
let calls: Call[];

/** Duas aplicações Pluggy: o item só existe para a chave da Karen. */
function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({ url, key: headers["X-API-KEY"], body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.endsWith("/auth")) {
    const { clientId } = JSON.parse(String(init!.body));
    if (clientId === "id-g") return json(200, { apiKey: "key-g" });
    if (clientId === "id-k") return json(200, { apiKey: "key-k" });
    return json(403, {});
  }
  if (url.includes("/items/")) return headers["X-API-KEY"] === "key-k" ? json(200, { id: ITEM, status: "UPDATED" }) : json(404, {});
  if (url.includes("/accounts")) return headers["X-API-KEY"] === "key-k" ? json(200, { results: [{ id: "a" }] }) : json(404, {});
  return json(404, {});
}

beforeEach(() => {
  calls = [];
  resetPluggyKeyCache();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lista fechada de credenciais", () => {
  it("só aceita principal e karen", () => {
    expect(parseCredential("principal")).toBe("principal");
    expect(parseCredential("karen")).toBe("karen");
    for (const v of ["", "KAREN", "admin", null, undefined, 1]) expect(parseCredential(v)).toBeNull();
  });
  it("lista só as que têm ID e Secret", () => {
    expect(configuredCredentials({ ...ENV })).toEqual(["principal", "karen"]);
    expect(configuredCredentials({ PLUGGY_CLIENT_ID: "a", PLUGGY_CLIENT_SECRET: "b", PLUGGY_CLIENT_ID_KAREN: "x" })).toEqual(["principal"]);
    expect(configuredCredentials({})).toEqual([]);
  });
  it("pluggyConfigured por credencial", () => {
    vi.stubEnv("PLUGGY_CLIENT_SECRET_KAREN", "");
    expect(pluggyConfigured("principal")).toBe(true);
    expect(pluggyConfigured("karen")).toBe(false);
    expect(pluggyConfigured()).toBe(true);
    expect(pluggyCredentials()).toEqual(["principal"]);
  });
});

describe("cliente com duas aplicações", () => {
  it("item da Karen é lido com a credencial da Karen e dá 404 com a principal", async () => {
    await expect(getItem(ITEM, "karen")).resolves.toMatchObject({ id: ITEM });
    await expect(getItem(ITEM)).rejects.toMatchObject({ status: 404, kind: "not_found", credential: "principal" });
    await expect(getItem(ITEM, "principal")).rejects.toBeInstanceOf(PluggyError);
    await expect(listAccounts(ITEM, "karen")).resolves.toHaveLength(1);
  });

  it("cache de token separado por credencial, sem misturar", async () => {
    await getItem(ITEM, "karen");
    await getItem(ITEM, "karen");
    await getItem(ITEM, "principal").catch(() => {});
    const auths = calls.filter((c) => c.url.endsWith("/auth")).map((c) => c.body!.clientId);
    expect(auths).toEqual(["id-k", "id-g"]); // Karen autenticou 1 vez (cache), principal a sua
    const keys = calls.filter((c) => c.key).map((c) => c.key);
    expect(keys).toEqual(["key-k", "key-k", "key-g"]);
  });

  it("credencial não configurada é rejeitada sem chamar a rede e cita a conta", async () => {
    vi.stubEnv("PLUGGY_CLIENT_ID_KAREN", "");
    const err = await getItem(ITEM, "karen").catch((e) => e);
    expect(err).toBeInstanceOf(PluggyError);
    expect(err.kind).toBe("auth");
    expect(calls).toHaveLength(0);
    expect(pluggyErrorMessage(err)).toContain("da Karen");
  });

  it("credenciais recusadas dizem qual par falhou, sem expor valores", async () => {
    vi.stubEnv("PLUGGY_CLIENT_ID_KAREN", "errado");
    const err = await getItem(ITEM, "karen").catch((e) => e);
    const msg = pluggyErrorMessage(err);
    expect(msg).toContain("credenciais da Karen");
    for (const text of [msg, pluggyErrorLog(err), err.message]) {
      expect(text).not.toContain("errado");
      expect(text).not.toContain("sec-k");
    }
  });
});

describe("mensagens", () => {
  it("404 cita a conta e lembra de escolher a conta do Meu Pluggy certa", () => {
    const m = pluggyErrorMessage(new PluggyError("x", 404, "not_found", "principal"));
    expect(m).toContain("credenciais do Gabriel");
    expect(m).toContain("conta do Meu Pluggy certa");
    expect(pluggyErrorMessage(new PluggyError("x", 404, "not_found", "karen"))).toContain("credenciais da Karen");
  });
});

import { credentialForNewItem, credentialForStoredItem, CREDENTIAL_UNKNOWN_MSG } from "@/lib/pluggy/credentials";

describe("decisão de credencial", () => {
  it("novo item: campo obrigatório, lista fechada e configurada", () => {
    expect(credentialForNewItem("karen", ENV)).toEqual({ ok: true, credential: "karen" });
    expect(credentialForNewItem("", ENV)).toMatchObject({ ok: false });
    expect(credentialForNewItem(undefined, ENV)).toMatchObject({ ok: false });
    expect(credentialForNewItem("outra", ENV)).toMatchObject({ ok: false });
    const semKaren = { PLUGGY_CLIENT_ID: "a", PLUGGY_CLIENT_SECRET: "b" };
    expect(credentialForNewItem("karen", semKaren)).toMatchObject({ ok: false, error: expect.stringContaining("não estão configuradas") });
  });
  it("item gravado: desconhecida tem mensagem própria; não configurada falha isolada", () => {
    expect(credentialForStoredItem("principal", ENV)).toEqual({ ok: true, credential: "principal" });
    expect(credentialForStoredItem("x", ENV)).toEqual({ ok: false, error: CREDENTIAL_UNKNOWN_MSG });
    expect(CREDENTIAL_UNKNOWN_MSG).not.toMatch(/inesperada|Tente de novo/);
    const r = credentialForStoredItem("karen", {});
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("da Karen") });
  });
});
