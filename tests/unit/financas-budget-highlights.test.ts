import { describe, expect, it } from "vitest";
import { budgetHighlights } from "@/lib/financas/budget-highlights";

const names: Record<string, string> = { mercado: "Mercado", moradia: "Moradia", lazer: "Lazer", saude: "Saúde" };
const nameOf = (id: string) => names[id] ?? "?";

describe("budgetHighlights", () => {
  const budgets = new Map([
    ["mercado", { amount: 2000 }],
    ["moradia", { amount: 1200 }],
    ["lazer", { amount: 500 }],
    ["saude", { amount: 300 }],
  ]);

  it("ordena da categoria mais pressionada para a menos e limita a 3", () => {
    const spent = new Map<string | null, number>([
      ["mercado", 1730],
      ["moradia", 1230],
      ["lazer", 100],
      ["saude", 0],
    ]);
    const rows = budgetHighlights(budgets, spent, nameOf);
    expect(rows.map((r) => r.name)).toEqual(["Moradia", "Mercado", "Lazer"]);
    expect(rows[0].ratio).toBeGreaterThan(1);
  });

  it("categoria sem gasto no mês entra com 0 e orçamento zerado fica de fora", () => {
    const rows = budgetHighlights(new Map([["lazer", { amount: 500 }], ["saude", { amount: 0 }]]), new Map(), nameOf, 5);
    expect(rows).toEqual([{ categoryId: "lazer", name: "Lazer", spent: 0, amount: 500, ratio: 0 }]);
  });

  it("arredonda o gasto em centavos", () => {
    const rows = budgetHighlights(new Map([["mercado", { amount: 1000 }]]), new Map([["mercado", 152.3000000001]]), nameOf);
    expect(rows[0].spent).toBe(152.3);
  });
});
