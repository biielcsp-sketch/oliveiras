import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_AUTH, callbackFailurePath, safeNextPath } from "@/lib/auth-redirect";

describe("safeNextPath", () => {
  it("aceita só /redefinir-senha", () => {
    expect(safeNextPath("/redefinir-senha")).toBe("/redefinir-senha");
  });

  it.each([
    null,
    undefined,
    "",
    "/inicio",
    "//evil.example",
    "///evil.example",
    "https://evil.example",
    "http://evil.example/redefinir-senha",
    "javascript:alert(1)",
    "\\\\evil.example",
    "/\\evil.example",
    "/redefinir-senha/",
    "/redefinir-senha?x=1",
    "/redefinir-senha/../inicio",
    " /redefinir-senha",
    "/REDEFINIR-SENHA",
  ])("rejeita %j e cai no destino padrão", (v) => {
    expect(safeNextPath(v)).toBe(DEFAULT_AFTER_AUTH);
  });
});

// Regressão: o navegador abriu o link de recuperação duas vezes ao mesmo tempo; a 2ª troca do
// código falhava e mandava ao login (ou direto ao /inicio, já com a sessão da 1ª).
describe("callbackFailurePath", () => {
  it("no fluxo de redefinição segue para /redefinir-senha, que decide pela sessão", () => {
    expect(callbackFailurePath("/redefinir-senha")).toBe("/redefinir-senha?erro=link");
  });

  it.each([null, undefined, "", "/inicio", "//evil.example", "https://evil.example"])(
    "para %j volta ao login com aviso de link",
    (v) => {
      expect(callbackFailurePath(v)).toBe("/login?erro=link");
    },
  );
});
