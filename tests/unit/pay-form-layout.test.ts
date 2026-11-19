import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regressão: o <fieldset> tem min-width: min-content por padrão, então um lançamento com
 * descrição longa (Pix QR Code ...) alargava a tela de pagar além da largura do celular e o
 * truncate das linhas não tinha efeito. O fieldset precisa de min-w-0.
 */
describe("PayForm: lista de lançamentos sugeridos", () => {
  const src = readFileSync("src/app/(app)/financas/_components/pay-form.tsx", "utf8");

  it("o fieldset da lista não impõe largura mínima do conteúdo", () => {
    const tag = src.match(/<fieldset[^>]*className="([^"]*)"/);
    expect(tag).not.toBeNull();
    expect(tag![1].split(/\s+/)).toContain("min-w-0");
  });

  it("a descrição continua truncada dentro de um bloco que pode encolher", () => {
    expect(src).toMatch(/min-w-0 flex-1/);
    expect(src).toMatch(/block truncate/);
  });
});
