import { describe, expect, it } from "vitest";
import { abbreviateBRL, budgetBlocks, budgetStatus, spendSegments } from "@/lib/financas/budget-view";

describe("budgetStatus", () => {
  it("sem meta", () => {
    expect(budgetStatus(50, undefined)).toBe("sem-meta");
    expect(budgetStatus(50, 0)).toBe("sem-meta");
    expect(budgetStatus(0, null)).toBe("sem-meta");
  });
  it("limiares 80% e 100%", () => {
    expect(budgetStatus(79.99, 100)).toBe("ok");
    expect(budgetStatus(80, 100)).toBe("atencao");
    expect(budgetStatus(100, 100)).toBe("atencao");
    expect(budgetStatus(100.01, 100)).toBe("estourou");
    expect(budgetStatus(0, 100)).toBe("ok");
  });
});

describe("budgetBlocks", () => {
  const cats = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: id.toUpperCase(), color: "#000" }));
  const budgets = new Map([
    ["a", { amount: 100, override: false }],
    ["b", { amount: 100, override: true }],
    ["c", { amount: 100, override: false }],
  ]);
  const spent = new Map<string | null, number>([["a", 50], ["b", 150], ["c", 90], ["d", 10], ["e", 30], ["f", 0]]);
  const blocks = budgetBlocks(cats, budgets, spent);

  it("oculta sem meta e sem gasto", () => {
    expect(blocks.map((b) => b.categoryId)).not.toContain("f");
  });
  it("ordena estouradas, proporção desc, sem meta por gasto desc", () => {
    expect(blocks.map((b) => b.categoryId)).toEqual(["b", "c", "a", "e", "d"]);
  });
  it("meta sem gasto continua visível; sem meta tem ratio 0", () => {
    const b = budgetBlocks(cats, budgets, new Map());
    expect(b.map((x) => x.categoryId).sort()).toEqual(["a", "b", "c"]);
    expect(blocks.find((x) => x.categoryId === "e")).toMatchObject({ status: "sem-meta", amount: null, ratio: 0 });
    expect(blocks.find((x) => x.categoryId === "b")?.override).toBe(true);
  });
});

describe("spendSegments", () => {
  const nameOf = (id: string | null) => id ?? "Sem categoria";
  it("top 4 + Outras e soma dos arcos = circunferência", () => {
    const data = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({ category_id: id, total: 100 - i * 10 }));
    const segs = spendSegments(data, nameOf);
    expect(segs.map((s) => s.label)).toEqual(["a", "b", "c", "d", "Outras"]);
    expect(segs[4].total).toBe(110);
    expect(segs.reduce((s, x) => s + x.arc, 0)).toBeCloseTo(100, 8);
    expect(segs.reduce((s, x) => s + x.length + x.gap, 0)).toBeCloseTo(100, 8);
  });
  it("até 4 categorias não cria Outras; uma só não tem espaço", () => {
    expect(spendSegments([{ category_id: "a", total: 5 }], nameOf)).toMatchObject([{ arc: 100, gap: 0, length: 100 }]);
    expect(spendSegments(["a", "b", "c", "d"].map((c) => ({ category_id: c, total: 1 })), nameOf)).toHaveLength(4);
  });
  it("total zero ou vazio não quebra", () => {
    expect(spendSegments([], nameOf)).toEqual([]);
    expect(spendSegments([{ category_id: "a", total: 0 }], nameOf)).toEqual([]);
  });
});

describe("abbreviateBRL", () => {
  it("abrevia", () => {
    expect(abbreviateBRL(3140)).toBe("R$ 3,1 mil");
    expect(abbreviateBRL(3000)).toBe("R$ 3 mil");
    expect(abbreviateBRL(850.4)).toBe("R$ 850");
    expect(abbreviateBRL(0)).toBe("R$ 0");
    expect(abbreviateBRL(999_960)).toBe("R$ 1 mi");
    expect(abbreviateBRL(1_250_000)).toBe("R$ 1,3 mi");
  });
});
