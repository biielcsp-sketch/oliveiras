import { describe, expect, it } from "vitest";
import { PASSKEY_MSG, registerErrorMessage, signInErrorMessage } from "@/lib/passkey-errors";

const notAllowed = { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause: { name: "NotAllowedError" } };

describe("mensagens de erro da digital", () => {
  it("entrada: cancelado, não cadastrada, desligada e genérico", () => {
    expect(signInErrorMessage(notAllowed)).toBe(PASSKEY_MSG.cancelled);
    expect(signInErrorMessage({ code: "ERROR_CEREMONY_ABORTED" })).toBe(PASSKEY_MSG.cancelled);
    expect(signInErrorMessage({ code: "webauthn_credential_not_found" })).toBe(PASSKEY_MSG.notRegistered);
    expect(signInErrorMessage({ code: "passkey_disabled" })).toBe(PASSKEY_MSG.disabled);
    // Resposta real do Auth para chave removida/desconhecida
    expect(signInErrorMessage({ code: "webauthn_verification_failed" })).toBe(PASSKEY_MSG.notRegistered);
    expect(signInErrorMessage({ code: "webauthn_challenge_expired" })).toBe(PASSKEY_MSG.signInFailed);
    expect(signInErrorMessage(null)).toBe(PASSKEY_MSG.signInFailed);
  });

  it("cadastro: aparelho já cadastrado (servidor ou navegador), limite e genérico", () => {
    expect(registerErrorMessage(notAllowed)).toBe(PASSKEY_MSG.cancelled);
    expect(registerErrorMessage({ code: "webauthn_credential_exists" })).toBe(PASSKEY_MSG.alreadyRegistered);
    expect(registerErrorMessage({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toBe(
      PASSKEY_MSG.alreadyRegistered,
    );
    expect(registerErrorMessage({ code: "too_many_passkeys" })).toBe(PASSKEY_MSG.tooMany);
    expect(registerErrorMessage({ code: "passkey_disabled" })).toBe(PASSKEY_MSG.disabled);
    expect(registerErrorMessage({ code: "algo_novo" })).toBe(PASSKEY_MSG.registerFailed);
  });
});
