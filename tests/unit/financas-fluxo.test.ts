import { describe, expect, it } from "vitest";
import { filterByFluxo, parseFluxo } from "@/lib/financas/fluxo";
import { summarize } from "@/lib/financas/summary";
import type { Category, Transaction } from "@/lib/financas/types";

const cats = [
  { id: "rec", name: "Salário", kind: "receita", color: "#000" },
  { id: "des", name: "Mercado", kind: "despesa", color: "#000" },
  { id: "tra", name: "Transferência entre contas", kind: "transferencia", color: "#000" },
] as Category[];
const tx = (id: string, amount: number, category_id: string | null, extra: Partial<Transaction> = {}) =>
  ({ id, amount, category_id, account_id: "cc", date: "2026-10-01", description: id, ...extra }) as Transaction;
const rows = [
  tx("sal", 1000, "rec"),
  tx("mer", -50, "des"),
  tx("estorno", 10, "des"), // positivo em despesa: abate despesa, é saída
  tx("sem-cat-in", 5, null),
  tx("sem-cat-out", -7, null),
  tx("tr", -100, "tra"),
  tx("par", 300, null, { transfer_group: "g1" }),
  tx("fatura", 200, null, { account_id: "card" }),
];
const card = new Set(["card"]);
const ids = (l: Transaction[]) => l.map((t) => t.id);

describe("parseFluxo", () => {
  it("aceita só entradas e saidas", () => {
    expect(parseFluxo("entradas")).toBe("entradas");
    expect(parseFluxo("saidas")).toBe("saidas");
  });
  it("ignora qualquer outro valor", () => {
    for (const v of ["", "saídas", "ENTRADAS", "todos", "entradas,saidas", undefined, null]) expect(parseFluxo(v)).toBeUndefined();
  });
});

describe("filterByFluxo", () => {
  it("sem fluxo devolve tudo", () => {
    expect(filterByFluxo(rows, undefined, cats, card)).toBe(rows);
  });
  it("entradas e saídas seguem a regra do summarize, sem transferência, par nem fatura", () => {
    expect(ids(filterByFluxo(rows, "entradas", cats, card))).toEqual(["sal", "sem-cat-in"]);
    expect(ids(filterByFluxo(rows, "saidas", cats, card))).toEqual(["mer", "estorno", "sem-cat-out"]);
  });
  it("soma do filtro bate com os totais do summarize", () => {
    const s = summarize(rows, cats, card);
    const sum = (l: Transaction[]) => Math.round(l.reduce((a, t) => a + t.amount, 0) * 100) / 100;
    expect(sum(filterByFluxo(rows, "entradas", cats, card))).toBe(s.income);
    expect(-sum(filterByFluxo(rows, "saidas", cats, card))).toBe(s.expense);
  });
  it("crédito sem categoria em conta normal é entrada; em cartão fica fora", () => {
    const l = [tx("a", 5, null), tx("b", 5, null, { account_id: "card" })];
    expect(ids(filterByFluxo(l, "entradas", cats, card))).toEqual(["a"]);
    expect(ids(filterByFluxo(l, "entradas", cats))).toEqual(["a", "b"]);
  });
});
