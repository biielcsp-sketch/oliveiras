import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_AUTH, safeNextPath } from "@/lib/auth-redirect";

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
