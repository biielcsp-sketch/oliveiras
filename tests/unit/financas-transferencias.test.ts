import { describe, expect, it } from "vitest";
import { findTransferPairs, firstNames, parseTipo, splitByTipo, TX_TIPOS, type PairTx } from "@/lib/financas/transfers";
import { summarize } from "@/lib/financas/summary";
import type { Category, Transaction } from "@/lib/financas/types";

// Nomes fictícios.
const MEMBERS = ["Fulano da Silva", "Beltrana Souza", "Jo"];
const ACCOUNTS = [
  { id: "corr-a", kind: "corrente" },
  { id: "corr-b", kind: "corrente" },
  { id: "card-a", kind: "cartao" },
];
const CATS = [
  { id: "sal", name: "Salário", kind: "receita" },
  { id: "saude", name: "Saúde", kind: "despesa" },
  { id: "transf", name: "Transferência entre contas", kind: "transferencia" },
  { id: "cartao", name: "Pagamento Cartão de Crédito", kind: "transferencia" },
];
let n = 0;
const tx = (o: Partial<PairTx>): PairTx => ({
  id: `t${++n}`, account_id: "corr-a", date: "2026-11-10", description: "X", amount: -10, category_id: null,
  category_source: null, transfer_group: null, transfer_checked: false, ...o,
});

describe("firstNames", () => {
  it("primeiro nome normalizado com 3+ letras", () => expect(firstNames(MEMBERS)).toEqual(["fulano", "beltrana"]));
});

describe("findTransferPairs", () => {
  it("Pix entre contas do casal pareia", () => {
    const out = tx({ account_id: "corr-a", amount: -250, description: "PIX ENVIADO Beltrana Souza" });
    const inn = tx({ account_id: "corr-b", amount: 250, date: "2026-11-11", description: "Pix recebido" });
    expect(findTransferPairs([out, inn], ACCOUNTS, MEMBERS, CATS)).toEqual({
      pairs: [{ outId: out.id, inId: inn.id, kind: "transferencia" }],
      review: [],
    });
  });

  it("compra de R$10 na farmácia que coincide com Pix recebido de R$10 NÃO pareia", () => {
    const out = tx({ account_id: "corr-a", amount: -10, description: "FARMACIA BOA SAUDE" });
    const inn = tx({ account_id: "corr-b", amount: 10, description: "Pix recebido" });
    expect(findTransferPairs([out, inn], ACCOUNTS, MEMBERS, CATS)).toEqual({ pairs: [], review: [] });
  });

  it("pagamento de fatura corrente → cartão 'PAGAMENTO COM SALDO' pareia como cartão", () => {
    const out = tx({ account_id: "corr-a", amount: -1200, description: "PAG FATURA CARTAO", category_id: "cartao", category_source: "regra" });
    const inn = tx({ account_id: "card-a", amount: 1200, date: "2026-11-12", description: "PAGAMENTO COM SALDO" });
    expect(findTransferPairs([out, inn], ACCOUNTS, MEMBERS, CATS).pairs).toEqual([{ outId: out.id, inId: inn.id, kind: "cartao" }]);
  });

  it("datas longe demais não pareiam", () => {
    const out = tx({ account_id: "corr-a", amount: -1200, description: "PAG FATURA", date: "2026-11-01" });
    const inn = tx({ account_id: "card-a", amount: 1200, description: "PAGAMENTO COM SALDO", date: "2026-11-05" });
    expect(findTransferPairs([out, inn], ACCOUNTS, MEMBERS, CATS).pairs).toEqual([]);
  });

  it("dois candidatos de R$10 → nenhum par, tudo em conferência 'ambiguo'", () => {
    const out = tx({ account_id: "corr-a", amount: -10, description: "PIX ENVIADO Fulano" });
    const in1 = tx({ account_id: "corr-b", amount: 10, description: "Pix recebido" });
    const in2 = tx({ account_id: "corr-b", amount: 10, description: "Pix recebido", date: "2026-11-11" });
    const r = findTransferPairs([out, in1, in2], ACCOUNTS, MEMBERS, CATS);
    expect(r.pairs).toEqual([]);
    expect(r.review).toEqual([
      { outId: out.id, inId: in1.id, kind: "transferencia", reason: "ambiguo" },
      { outId: out.id, inId: in2.id, kind: "transferencia", reason: "ambiguo" },
    ]);
  });

  it("perna com categoria manual 'Salário' → conferência 'categoria'", () => {
    const out = tx({ account_id: "corr-a", amount: -800, description: "PIX ENVIADO Beltrana" });
    const inn = tx({ account_id: "corr-b", amount: 800, description: "Pix recebido Fulano", category_id: "sal", category_source: "manual" });
    expect(findTransferPairs([out, inn], ACCOUNTS, MEMBERS, CATS)).toEqual({
      pairs: [],
      review: [{ outId: out.id, inId: inn.id, kind: "transferencia", reason: "categoria" }],
    });
  });

  it("ignora já agrupados e os marcados como 'não é transferência'", () => {
    const out = tx({ amount: -50, description: "PIX ENVIADO Fulano", transfer_checked: true });
    const inn = tx({ account_id: "corr-b", amount: 50 });
    const out2 = tx({ amount: -60, description: "PIX ENVIADO Fulano", transfer_group: "g" });
    const inn2 = tx({ account_id: "corr-b", amount: 60 });
    expect(findTransferPairs([out, inn, out2, inn2], ACCOUNTS, MEMBERS, CATS)).toEqual({ pairs: [], review: [] });
  });
});

describe("summarize ignora pernas de transferência", () => {
  it("transfer_group preenchido fica fora dos totais", () => {
    const base = { member_id: null, notes: null, source: "manual", date: "2026-11-10", description: "x" };
    const txs: Transaction[] = [
      { ...base, id: "1", account_id: "corr-a", amount: -250, category_id: null, transfer_group: "g1" },
      { ...base, id: "2", account_id: "corr-b", amount: 250, category_id: "sal", transfer_group: "g1" },
      { ...base, id: "3", account_id: "corr-a", amount: -40, category_id: "saude" },
    ];
    const s = summarize(txs, CATS as Category[]);
    expect(s).toMatchObject({ income: 0, expense: 40 });
  });
});

describe("splitByTipo", () => {
  const legOut = { ...tx({ account_id: "corr-a", amount: -100, transfer_group: "g1", category_id: "transf" }) };
  const legIn = { ...tx({ account_id: "corr-b", amount: 100, transfer_group: "g1", category_id: "transf" }) };
  const card = { ...tx({ account_id: "card-a", amount: 300, transfer_group: "g2" }) };
  const cardOut = { ...tx({ account_id: "corr-a", amount: -300, transfer_group: "g2" }) };
  const gasto = tx({ amount: -20, category_id: "saude" });
  const semPar = tx({ amount: -70, category_id: "transf" });
  const all = [legOut, legIn, card, cardOut, gasto, semPar];

  it("gastos: sem par e sem categoria de transferência", () =>
    expect(splitByTipo("gastos", all, CATS, ACCOUNTS).rows.map((t) => t.id)).toEqual([gasto.id]));
  it("gastos nunca traz o pagamento de fatura (evita dupla contagem)", () => {
    const ids = splitByTipo("gastos", all, CATS, ACCOUNTS).rows.map((t) => t.id);
    expect(ids).not.toContain(card.id);
    expect(ids).not.toContain(cardOut.id);
  });
  it("transferências: pares (inclusive fatura) em uma linha + sem par com categoria de transferência", () => {
    const r = splitByTipo("transferencias", all, CATS, ACCOUNTS, [card, cardOut]);
    expect(r.pairs.map((p) => [p.out.id, p.in.id, p.kind]).sort()).toEqual(
      [[legOut.id, legIn.id, "transferencia"], [cardOut.id, card.id, "cartao"]].sort(),
    );
    expect(r.rows.map((t) => t.id)).toEqual([semPar.id]);
  });
  it("transferências: completa a perna da fatura que o filtro não trouxe", () => {
    const r = splitByTipo("transferencias", [card], CATS, ACCOUNTS, [card, cardOut]);
    expect(r.pairs.map((p) => [p.out.id, p.in.id, p.kind])).toEqual([[cardOut.id, card.id, "cartao"]]);
  });
});

describe("abas de lançamentos", () => {
  it("só Gastos e Transferências", () => expect(TX_TIPOS.map((t) => t.value)).toEqual(["gastos", "transferencias"]));
  it("tipo=cartao antigo cai em Transferências", () => {
    expect(parseTipo("cartao")).toBe("transferencias");
    expect(parseTipo("transferencias")).toBe("transferencias");
    expect(parseTipo("gastos")).toBe("gastos");
    expect(parseTipo("xyz")).toBe("gastos");
    expect(parseTipo(undefined)).toBe("gastos");
  });
});
