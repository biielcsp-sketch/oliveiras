import { describe, expect, it } from "vitest";
import { dayLabel, monthGrid, monthLabel, shiftMonth, yearMonthOf } from "@/lib/calendar";

describe("monthGrid", () => {
  it("novembro de 2026 começa no domingo e tem 5 semanas", () => {
    const g = monthGrid({ year: 2026, month: 11 });
    expect(g).toHaveLength(5);
    expect(g[0][0]).toBe("2026-11-01");
    expect(g[4][1]).toBe("2026-11-30");
    expect(g[4].slice(2)).toEqual([null, null, null, null, null]);
  });
  it("fevereiro bissexto tem 29 dias e preenche o início com null", () => {
    const g = monthGrid({ year: 2028, month: 2 }); // 1/2/2028 é terça
    expect(g[0].slice(0, 2)).toEqual([null, null]);
    expect(g[0][2]).toBe("2028-02-01");
    expect(g.flat().filter(Boolean)).toHaveLength(29);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
});

describe("shiftMonth / yearMonthOf", () => {
  it("vira o ano nos dois sentidos", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
  it("lê AAAA-MM-DD", () => {
    expect(yearMonthOf("2026-11-08")).toEqual({ year: 2026, month: 11 });
  });
});

describe("rótulos em pt-BR", () => {
  it("mês com inicial maiúscula", () => {
    expect(monthLabel({ year: 2026, month: 3 })).toBe("Março de 2026");
  });
  it("dia por extenso sem deslocar pelo fuso", () => {
    expect(dayLabel("2026-11-01")).toBe("domingo, 1 de novembro de 2026");
  });
});
