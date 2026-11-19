import { describe, expect, it } from "vitest";
import { buildTransferFeed, dayLabel, groupByDay, parseMostrar, sliceVisible } from "@/lib/financas/lancamentos-view";

describe("parseMostrar", () => {
  it("padrão 20 e valida entrada", () => {
    expect(parseMostrar(undefined)).toBe(20);
    expect(parseMostrar("abc")).toBe(20);
    expect(parseMostrar("-5")).toBe(20);
    expect(parseMostrar("0")).toBe(20);
    expect(parseMostrar("1.5")).toBe(20);
    expect(parseMostrar("40")).toBe(40);
    expect(parseMostrar("45")).toBe(60);
    expect(parseMostrar("999999")).toBe(2000);
    expect(parseMostrar("99999999999")).toBe(20);
  });
});

describe("sliceVisible", () => {
  it("fatia e informa se há mais", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    expect(sliceVisible(items, 20)).toMatchObject({ hasMore: true, total: 45 });
    expect(sliceVisible(items, 20).shown).toHaveLength(20);
    expect(sliceVisible(items, 60)).toMatchObject({ hasMore: false, total: 45 });
  });
});

describe("dayLabel / groupByDay", () => {
  const today = "2026-11-18";
  it("Hoje, Ontem, dia e mês, com ano se for outro", () => {
    expect(dayLabel("2026-11-18", today)).toBe("Hoje");
    expect(dayLabel("2026-11-17", today)).toBe("Ontem");
    expect(dayLabel("2026-11-12", today)).toBe("12 de nov");
    expect(dayLabel("2025-12-31", today)).toBe("31 de dez de 2025");
    expect(dayLabel("2026-03-01", "2026-03-02")).toBe("Ontem");
    expect(dayLabel("2026-02-28", "2026-03-01")).toBe("Ontem");
  });
  it("agrupa mantendo a ordem", () => {
    const g = groupByDay(
      [{ date: "2026-11-18", n: 1 }, { date: "2026-11-18", n: 2 }, { date: "2026-11-12", n: 3 }],
      today,
    );
    expect(g.map((x) => [x.label, x.items.map((i) => i.n)])).toEqual([["Hoje", [1, 2]], ["12 de nov", [3]]]);
  });
});

describe("buildTransferFeed", () => {
  const cats = [{ id: "fat", name: "Pagamento Cartão de Crédito" }, { id: "tr", name: "Transferência entre contas" }];
  it("junta pares e linhas por data e marca fatura", () => {
    const pair = (group: string, date: string, kind: "cartao" | "transferencia") => ({
      group, kind, date, amount: 10, out: { id: `${group}o`, date, category_id: null as string | null }, in: { id: `${group}i`, date, category_id: null as string | null },
    });
    const feed = buildTransferFeed(
      [pair("a", "2026-11-10", "transferencia"), pair("b", "2026-11-12", "cartao")],
      [{ id: "x", date: "2026-11-11", category_id: "fat" }, { id: "y", date: "2026-11-09", category_id: "tr" }],
      cats,
    );
    expect(feed.map((f) => [f.key, f.fatura])).toEqual([["p-b", true], ["t-x", true], ["p-a", false], ["t-y", false]]);
  });
});
