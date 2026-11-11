import { describe, expect, it, vi } from "vitest";
import { PASSKEY_MSG } from "@/lib/passkey-errors";
import { runPasskeySignIn } from "@/lib/passkey-sign-in";

const client = (res: unknown) => async () => ({ auth: { signInWithPasskey: async () => res as never } });

describe("runPasskeySignIn", () => {
  it("caminho feliz: sessão criada", async () => {
    expect(await runPasskeySignIn(client({ data: { session: {} }, error: null }), false)).toEqual({ ok: true });
  });

  it("loader rejeita: não lança e mostra mensagem (não silencioso)", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("ChunkLoadError"));
    expect(await runPasskeySignIn(loader, false)).toEqual({ ok: false, message: PASSKEY_MSG.loadFailed });
  });

  it("loader rejeita no pedido automático: silêncio, sem rejeição", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("ChunkLoadError"));
    await expect(runPasskeySignIn(loader, true)).resolves.toEqual({ ok: false, message: null });
  });

  it("signInWithPasskey lança: mesmo tratamento", async () => {
    const loader = async () => ({ auth: { signInWithPasskey: async () => Promise.reject(new Error("x")) } });
    expect(await runPasskeySignIn(loader, false)).toEqual({ ok: false, message: PASSKEY_MSG.loadFailed });
    expect(await runPasskeySignIn(loader, true)).toEqual({ ok: false, message: null });
  });

  it("erro do Auth: mensagem mapeada, ou silêncio no automático", async () => {
    const res = { data: null, error: { code: "webauthn_credential_not_found" } };
    expect(await runPasskeySignIn(client(res), false)).toEqual({ ok: false, message: PASSKEY_MSG.notRegistered });
    expect(await runPasskeySignIn(client(res), true)).toEqual({ ok: false, message: null });
    expect(await runPasskeySignIn(client({ data: null, error: null }), false)).toEqual({
      ok: false,
      message: PASSKEY_MSG.signInFailed,
    });
  });
});
