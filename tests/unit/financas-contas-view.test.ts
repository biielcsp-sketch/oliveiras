import { describe, expect, it } from "vitest";
import {
  accountInitial,
  accountTotals,
  debtOf,
  kindFromTipo,
  limitAvailable,
  limitUsedPercent,
  logoColor,
  splitAccounts,
} from "@/lib/financas/contas-view";

const acc = (kind: "corrente" | "cartao" | "dinheiro", balance: number, archived = false) => ({ kind, balance, archived });

describe("contas x cartões", () => {
  it("separa cartões das demais contas", () => {
    const { banks, cards } = splitAccounts([acc("corrente", 1), acc("cartao", -2), acc("dinheiro", 3)]);
    expect(banks.map((a) => a.kind)).toEqual(["corrente", "dinheiro"]);
    expect(cards).toHaveLength(1);
  });

  it("totais: disponível sem cartões, faturas só de saldo negativo, arquivadas fora", () => {
    const t = accountTotals([
      acc("corrente", 1000.1),
      acc("dinheiro", 0.2),
      acc("cartao", -300.05),
      acc("cartao", 50), // crédito na fatura não abate a de outro cartão
      acc("cartao", -100, true),
      acc("corrente", 999, true),
    ]);
    expect(t.available).toBe(1000.3);
    expect(t.cardDebt).toBe(300.05);
  });

  it("dívida e limite disponível em centavos", () => {
    expect(debtOf(-10.1)).toBe(10.1);
    expect(debtOf(5)).toBe(0);
    expect(limitAvailable(300.05, 5000)).toBe(4699.95);
    expect(limitAvailable(6000, 5000)).toBe(-1000);
  });

  it("percentual do limite usado com clamp 0-100", () => {
    expect(limitUsedPercent(250, 1000)).toBe(25);
    expect(limitUsedPercent(2000, 1000)).toBe(100);
    expect(limitUsedPercent(-5, 1000)).toBe(0);
    expect(limitUsedPercent(100, null)).toBe(0);
    expect(limitUsedPercent(100, 0)).toBe(0);
  });

  it("?tipo= valida contra valores permitidos", () => {
    expect(kindFromTipo("conta")).toBe("corrente");
    expect(kindFromTipo("cartao")).toBe("cartao");
    expect(kindFromTipo("investimento")).toBeNull();
    expect(kindFromTipo(["cartao"])).toBeNull();
    expect(kindFromTipo(undefined)).toBeNull();
  });

  it("logo: inicial e cor estáveis", () => {
    expect(accountInitial({ name: "conta teste", institution: null })).toBe("C");
    expect(accountInitial({ name: "x", institution: " nubank" })).toBe("N");
    expect(accountInitial({ name: "", institution: null })).toBe("?");
    expect(logoColor("Nubank")).toBe(logoColor("Nubank"));
    expect(logoColor("Nubank")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
