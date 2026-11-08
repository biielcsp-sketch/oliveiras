import { describe, expect, it } from "vitest";
import {
  billStatus, dateInMonth, goalProgress, invoiceFor, invoiceTotals, resolveBudgets, suggestPayments,
} from "@/lib/financas/planning";
import type { Transaction } from "@/lib/financas/types";

const tx = (date: string, amount: number, category_id: string | null = null, id = `${date}${amount}`): Transaction => ({
  id, account_id: "card", date, description: "x", amount, category_id, member_id: null, notes: null, source: "manual",
});

describe("datas", () => {
  it("limita ao último dia do mês", () => {
    expect(dateInMonth("2026-02", 31)).toBe("2026-02-28");
    expect(dateInMonth("2028-02", 30)).toBe("2028-02-29");
    expect(dateInMonth("2026-11", 5)).toBe("2026-11-05");
  });
});

describe("fatura", () => {
  it("fecha 3 e vence 10: fecha no mesmo mês", () => {
    expect(invoiceFor("2026-11", 3, 10)).toEqual({
      month: "2026-11", start: "2026-10-03", closing: "2026-11-03", nextClosing: "2026-12-03", due: "2026-11-10",
    });
  });
  it("fecha 28 e vence 5: fecha no mês anterior", () => {
    expect(invoiceFor("2026-12", 28, 5)).toMatchObject({ start: "2026-10-28", closing: "2026-11-28", due: "2026-12-05" });
  });
  it("fechamento 31 em mês curto", () => {
    expect(invoiceFor("2026-03", 31, 10)).toMatchObject({ start: "2026-01-31", closing: "2026-02-28" });
  });

  it("soma compras do período, desconta estorno categorizado, ignora pagamento e compra do dia do fechamento", () => {
    const inv = invoiceFor("2026-11", 3, 10); // período 03/10 a 02/11
    const txs = [
      tx("2026-10-02", -999), // fatura anterior
      tx("2026-10-03", -100), // entra (primeiro dia)
      tx("2026-10-20", -50.5),
      tx("2026-10-25", 20, "merc"), // estorno categorizado abate
      tx("2026-11-02", -9.5), // último dia
      tx("2026-11-03", -70), // dia do fechamento: próxima fatura
      tx("2026-11-08", 140, "fat"), // pagamento
    ];
    expect(invoiceTotals(txs, new Set(["fat"]), inv)).toEqual({ total: 140, paid: 140 });
  });

  // Regressão: o pagamento sem categoria (ex.: "Pagamento recebido") caía no período da
  // fatura seguinte e era descontado como estorno, deixando o total negativo.
  it("pagamento sem categoria não abate as compras da fatura seguinte", () => {
    const dez = invoiceFor("2026-12", 3, 10); // período 03/11 a 02/12
    const txs = [tx("2026-11-04", -23.1), tx("2026-11-06", 500), tx("2026-11-05", 10)];
    expect(invoiceTotals(txs, new Set(["fat"]), dez).total).toBe(23.1);
  });
});

describe("orçamento", () => {
  const rows = [
    { category_id: "merc", month: null, amount: 1200 },
    { category_id: "merc", month: "2026-12", amount: 1800 },
    { category_id: "lazer", month: null, amount: 300 },
    { category_id: "lazer", month: "2026-10", amount: 0 },
  ];
  it("padrão vale todo mês", () => {
    const b = resolveBudgets(rows, "2026-11");
    expect(b.get("merc")).toEqual({ amount: 1200, override: false });
    expect(b.get("lazer")).toEqual({ amount: 300, override: false });
  });
  it("ajuste do mês vence o padrão", () => {
    expect(resolveBudgets(rows, "2026-12").get("merc")).toEqual({ amount: 1800, override: true });
    expect(resolveBudgets(rows, "2026-10").get("lazer")).toEqual({ amount: 0, override: true });
  });
});

describe("contas a pagar", () => {
  it.each([
    ["2026-11-05", true, "2026-11-20", "paga"],
    ["2026-11-05", false, "2026-11-06", "atrasada"],
    ["2026-11-05", false, "2026-11-05", "vence_hoje"],
    ["2026-11-05", false, "2026-11-01", "a_vencer"],
  ] as const)("vence %s, paga=%s, hoje %s → %s", (due, paid, today, expected) => {
    expect(billStatus(due, paid, today)).toBe(expected);
  });

  it("sugere o lançamento mais parecido e ignora os já vinculados, entradas e fora da janela", () => {
    const txs = [
      tx("2026-11-04", -1800, null, "certo"),
      tx("2026-11-05", -1790, null, "vinculado"),
      tx("2026-11-06", -1500, null, "parecido"),
      tx("2026-11-05", 1800, null, "entrada"),
      tx("2026-10-01", -1800, null, "longe"),
      tx("2026-11-05", -900, null, "diferente"),
    ];
    const ids = suggestPayments(1800, "2026-11-05", txs, new Set(["vinculado"])).map((t) => t.id);
    expect(ids).toEqual(["certo", "parecido"]);
  });
});

describe("metas", () => {
  it("progresso e quanto guardar por mês", () => {
    expect(goalProgress(12000, 30000, "2027-11-30", "2026-11-07")).toEqual({
      saved: 12000, remaining: 18000, pct: 0.4, monthsLeft: 12, perMonth: 1500,
    });
  });
  // Regressão: 1,10 / 1 mês mostrava 1,11 (erro de ponto flutuante arredondado para cima).
  it.each([
    [29998.9, "2026-12-31", 1.1],
    [29699.9, "2026-12-31", 300.1],
    [29900, "2027-02-28", 33.34],
  ])("guardar por mês sem centavo a mais (saldo %d)", (balance, date, expected) => {
    expect(goalProgress(balance, 30000, date, "2026-11-07").perMonth).toBe(expected);
  });

  it("meta atingida", () => {
    expect(goalProgress(31000, 30000, null, "2026-11-07")).toMatchObject({ remaining: 0, pct: 1, perMonth: null });
  });
  it("saldo negativo conta como zero; prazo no mês atual exige o restante todo", () => {
    expect(goalProgress(-50, 1000, "2026-11-30", "2026-11-07")).toMatchObject({ saved: 0, monthsLeft: 0, perMonth: 1000 });
  });
});
