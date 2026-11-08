import { describe, expect, it } from "vitest";
import { nextTheme, parseTheme } from "@/lib/theme";

describe("tema", () => {
  it("aceita só claro ou escuro no cookie", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme("<script>")).toBeNull();
  });
  it("alterna", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });
});

import { readFileSync } from "node:fs";

// Regressão: o escuro escolhido no botão precisa ter exatamente os mesmos tokens do escuro do aparelho.
describe("tokens do modo escuro", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const tokens = (block: string) =>
    Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  it("bloco do aparelho e bloco do botão são iguais", () => {
    const media = css.match(/:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/)![1];
    const forced = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)![1];
    expect(Object.keys(tokens(media)).length).toBeGreaterThan(20);
    expect(tokens(forced)).toEqual(tokens(media));
  });
});
