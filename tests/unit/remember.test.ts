import { describe, expect, it } from "vitest";
import { maskEmail, parseRememberedEmail, rememberCookieOptions } from "@/lib/remember";

describe("lembrar neste aparelho", () => {
  it("mascara o e-mail mantendo a primeira letra e o domínio", () => {
    expect(maskEmail("gabriel@gmail.com")).toBe("g***@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(maskEmail("semarroba")).toBe("***");
  });

  it("aceita só e-mail bem formado, em minúsculas", () => {
    expect(parseRememberedEmail("  Gabriel@Gmail.com ")).toBe("gabriel@gmail.com");
    for (const bad of [undefined, null, 42, "", "abc", "a@b", "a b@c.com", "<x>@y.com", "a@b.c\nSet-Cookie: x=1", `${"a".repeat(250)}@b.com`]) {
      expect(parseRememberedEmail(bad)).toBeNull();
    }
  });

  it("cookie httpOnly, lax, path / e ~180 dias", () => {
    const o = rememberCookieOptions();
    expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 15552000 });
  });
});
