import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL, sum } from "@/lib/financas/money";
import { monthLabel, monthRange, parseMonth, shiftMonth } from "@/lib/financas/period";
import { matchCategory, normalizeText } from "@/lib/financas/rules";
import { decodeStatement, parseOfx } from "@/lib/financas/ofx";
import { parseCsv } from "@/lib/financas/csv";
import { buildImportRows, suggestInvert } from "@/lib/financas/import";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

describe("parseBRL", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["-12,5", -12.5],
    ["12.50", 12.5],
    ["R$ 10", 10],
    ["1.000", 1000],
    ["(45,90)", -45.9],
    ["+3,00", 3],
    ["0,1", 0.1],
  ])("%s → %d", (input, expected) => expect(parseBRL(input)).toBe(expected));

  it.each(["", "abc", "1,2,3", "12.345,6.7", "1.23.4"])("rejeita %s", (input) => {
    expect(parseBRL(input)).toBeNull();
  });
});

describe("dinheiro", () => {
  it("formata em reais", () => expect(formatBRL(-1234.5).replace(/\s/g, " ")).toBe("-R$ 1.234,50"));
  it("soma sem erro de ponto flutuante", () => expect(sum([0.1, 0.2, -0.3])).toBe(0));
});

describe("período", () => {
  it("intervalo do mês", () => expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" }));
  it("navega meses", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
  });
  it("valida parâmetro", () => {
    expect(parseMonth("2026-13", new Date("2026-11-07T12:00:00Z"))).toBe("2026-11");
    expect(parseMonth("2026-05")).toBe("2026-05");
    expect(parseMonth("'; drop table", new Date("2026-11-07T12:00:00Z"))).toBe("2026-11");
  });
  it("rótulo em português", () => expect(monthLabel("2026-03")).toBe("Março de 2026"));
});

describe("regras", () => {
  const rules = [
    { pattern: "uber", category_id: "transporte" },
    { pattern: "uber eats", category_id: "alimentacao" },
    { pattern: "dizimo", category_id: "igreja" },
  ];
  it("ignora acento e caixa", () => expect(normalizeText("  DÍZIMO   Igreja ")).toBe("dizimo igreja"));
  it("padrão mais específico vence", () => expect(matchCategory("UBER EATS *PEDIDO", rules)).toBe("alimentacao"));
  it("encontra com acento na descrição", () => expect(matchCategory("Dízimo novembro", rules)).toBe("igreja"));
  it("sem correspondência", () => expect(matchCategory("Padaria", rules)).toBeNull());
});

describe("OFX", () => {
  const text = decodeStatement(fixture("extrato.ofx"));
  const { transactions, errors } = parseOfx(text);

  it("decodifica windows-1252", () => expect(text).toContain("Pão de Açúcar"));
  it("lê os 3 lançamentos", () => {
    expect(errors).toEqual([]);
    expect(transactions).toEqual([
      { date: "2026-11-03", description: "Pão de Açúcar - Mercado", amount: -152.3, externalId: "ofx:A1" },
      { date: "2026-11-05", description: "SALARIO EMPRESA & CIA", amount: 3500, externalId: "ofx:A2" },
      { date: "2026-11-06", description: "PAGAMENTO DE FATURA", amount: -89.9, externalId: "ofx:A3" },
    ]);
  });
  it("rejeita arquivo que não é OFX", () => expect(parseOfx("oi").errors).toHaveLength(1));
  it("decodifica UTF-8", () => expect(decodeStatement(new TextEncoder().encode("ção"))).toBe("ção"));
});

describe("CSV", () => {
  it("fatura com vírgula e ponto decimal", () => {
    const { transactions, errors } = parseCsv(decodeStatement(fixture("fatura-cartao.csv")));
    expect(errors).toEqual([]);
    expect(transactions.map((t) => t.amount)).toEqual([45.9, 45.9, 23.1, -10]);
    expect(transactions[0]).toMatchObject({ date: "2026-11-02", description: "Ifood *Restaurante", externalId: null });
  });

  it("extrato com ponto e vírgula, aspas, milhar e identificador", () => {
    const { transactions, errors } = parseCsv(decodeStatement(fixture("extrato-conta.csv")));
    expect(errors).toEqual(["Linha 5: data ou valor inválido."]);
    expect(transactions).toEqual([
      { date: "2026-11-01", description: "Dízimo Igreja", amount: -500, externalId: "csv:abc-1" },
      { date: "2026-11-03", description: 'Farmácia "Boa" Saúde', amount: -1234.56, externalId: "csv:abc-2" },
      { date: "2026-11-04", description: "Pix recebido", amount: 250, externalId: "csv:abc-3" },
    ]);
  });

  it("sem colunas reconhecíveis", () => {
    expect(parseCsv("a,b\n1,2").errors[0]).toContain("colunas");
  });
});

describe("importação", () => {
  const { transactions } = parseCsv(decodeStatement(fixture("fatura-cartao.csv")));
  const rules = [{ pattern: "ifood", category_id: "alim" }];

  it("sugere inverter sinal em fatura de cartão com compras positivas", () => {
    expect(suggestInvert(transactions, "cartao")).toBe(true);
    expect(suggestInvert(transactions, "corrente")).toBe(false);
  });

  it("compras iguais no mesmo dia viram dois lançamentos com ids diferentes", () => {
    const rows = buildImportRows(transactions, { invert: true, rules });
    expect(rows[0].external_id).not.toBe(rows[1].external_id);
    expect(rows[0].amount).toBe(-45.9);
    expect(rows[3].amount).toBe(10);
    expect(rows[0].category_id).toBe("alim");
    expect(rows[2].category_id).toBeNull();
  });

  it("reimportar o mesmo arquivo gera os mesmos ids (não duplica)", () => {
    const a = buildImportRows(transactions, { invert: true, rules }).map((r) => r.external_id);
    const b = buildImportRows(transactions, { invert: false, rules }).map((r) => r.external_id);
    expect(a).toEqual(b);
  });
});

import { summarize } from "@/lib/financas/summary";

describe("resumo do mês", () => {
  const categories = [
    { id: "merc", name: "Mercado", kind: "despesa" as const, color: "#000000" },
    { id: "sal", name: "Salário", kind: "receita" as const, color: "#000000" },
    { id: "fat", name: "Pagamento de fatura", kind: "transferencia" as const, color: "#000000" },
  ];
  const tx = (amount: number, category_id: string | null) => ({
    id: Math.random().toString(), account_id: "a", date: "2026-11-01", description: "x",
    amount, category_id, member_id: null, notes: null, source: "manual",
  });

  it("transferência (pagamento de fatura) fica fora dos totais", () => {
    const s = summarize([tx(3500, "sal"), tx(-100.1, "merc"), tx(-0.2, null), tx(-900, "fat")], categories);
    expect(s).toMatchObject({ income: 3500, expense: 100.3, result: 3399.7 });
    expect(s.expenseByCategory).toEqual([
      { category_id: "merc", total: 100.1 },
      { category_id: null, total: 0.2 },
    ]);
  });
});
