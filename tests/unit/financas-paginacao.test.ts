// Regressão: getTransactions/getTransactionsAround cortavam em 1000 linhas (max_rows do PostgREST) sem avisar,
// e os totais do mês (Finanças, orçamento, Oli) ficavam errados. O cliente simulado abaixo imita o PostgREST:
// nenhuma resposta passa de 1000 linhas, nem com `.limit(3000)`.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const MAX_ROWS = 1000;
let table: { id: string; amount: string; date: string }[] = [];
let failAtFrom: number | null = null;
const calls: { method: string; args: unknown[] }[] = [];

function fakeQuery() {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lt", "in", "is", "ilike", "order"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.limit = (n: number) => {
    to = n - 1;
    return builder;
  };
  builder.range = (a: number, b: number) => {
    calls.push({ method: "range", args: [a, b] });
    from = a;
    to = b;
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    if (failAtFrom !== null && from >= failAtFrom) return Promise.resolve({ data: null, error: { message: "falhou" } }).then(resolve, reject);
    const end = Math.min(to + 1, from + MAX_ROWS);
    return Promise.resolve({ data: table.slice(from, end), error: null }).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => fakeQuery() }) }));
vi.mock("@/lib/data", () => ({ getAppContext: async () => ({ household: { id: "h1" } }) }));

const { getTransactions } = await import("@/lib/financas/data");
const { getTransactionsAround } = await import("@/lib/financas/planning-data");
const { fetchAllPages } = await import("@/lib/financas/paginate");

const makeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${String(i).padStart(6, "0")}`,
    account_id: "a1",
    date: "2026-11-10",
    description: `Compra ${i}`,
    amount: "-1.00",
    category_id: null,
    member_id: null,
    notes: null,
    source: "manual",
  }));

beforeEach(() => {
  calls.length = 0;
  failAtFrom = null;
});

describe("getTransactions (paginado)", () => {
  it("1005 lançamentos no mês: devolve os 1005, soma certa e não marca incompleto", async () => {
    table = makeRows(1005);
    const txs = await getTransactions({ month: "2026-11" });
    expect(txs).toHaveLength(1005);
    expect(txs.reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100).toBe(-1005);
    expect(new Set(txs.map((t) => t.id)).size).toBe(1005);
    expect(txs.incomplete).toBe(false);
  });

  it("ordem estável: desempata por id", async () => {
    table = makeRows(3);
    await getTransactions({ month: "2026-11" });
    expect(calls.some((c) => c.method === "order" && c.args[0] === "id")).toBe(true);
  });

  it("a marca incomplete não vaza ao serializar nem ao fatiar", async () => {
    table = makeRows(2);
    const txs = await getTransactions({ month: "2026-11" });
    expect(JSON.parse(JSON.stringify(txs))).toHaveLength(2);
    expect(Object.keys(txs)).toEqual(["0", "1"]);
    expect("incomplete" in txs.slice(0, 1)).toBe(false);
  });
});

describe("getTransactionsAround (paginado)", () => {
  it("2500 lançamentos nos 4 meses: devolve todos (antes voltavam 1000)", async () => {
    table = makeRows(2500);
    const txs = await getTransactionsAround("2026-11", ["a1"]);
    expect(txs).toHaveLength(2500);
    expect(txs.incomplete).toBe(false);
  });
});

describe("fetchAllPages", () => {
  const pager = (from: number, to: number) =>
    (fakeQuery().range as (a: number, b: number) => unknown)(from, to) as PromiseLike<{ data: unknown[] | null; error: unknown }>;

  it("para na última página parcial", async () => {
    table = makeRows(2000);
    const { rows, incomplete } = await fetchAllPages(pager);
    expect(rows).toHaveLength(2000);
    expect(incomplete).toBe(false);
    // 2 páginas cheias + 1 vazia que confirma o fim
    expect(calls.filter((c) => c.method === "range").map((c) => c.args)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("acima do teto: devolve até o teto e marca incompleto", async () => {
    table = makeRows(2501);
    const { rows, incomplete } = await fetchAllPages(pager, { maxRows: 2500 });
    expect(rows).toHaveLength(2500);
    expect(incomplete).toBe(true);
  });

  it("exatamente no teto: completo", async () => {
    table = makeRows(2500);
    const { rows, incomplete } = await fetchAllPages(pager, { maxRows: 2500 });
    expect(rows).toHaveLength(2500);
    expect(incomplete).toBe(false);
  });

  it("falha numa página: devolve o que leu e marca incompleto", async () => {
    table = makeRows(1500);
    failAtFrom = 1000;
    const { rows, incomplete } = await fetchAllPages(pager);
    expect(rows).toHaveLength(1000);
    expect(incomplete).toBe(true);
  });
});

describe("Oli: resumo e contas com lista incompleta", async () => {
  const { buildResumo, buildContasAPagar, AVISO_INCOMPLETO } = await import("@/lib/oli/panels");
  it("resumo marca incompleto e avisa que os valores são parciais", () => {
    const d = buildResumo("2026-11", [], [], [], true);
    expect(d.incompleto).toBe(true);
    expect(d.aviso).toBe(AVISO_INCOMPLETO);
  });
  it("resumo completo não leva aviso", () => {
    const d = buildResumo("2026-11", [], [], []);
    expect(d.incompleto).toBeUndefined();
    expect(d.aviso).toBeUndefined();
  });
  it("contas a pagar avisa quando os lançamentos dos cartões vieram incompletos", () => {
    const d = buildContasAPagar({
      month: "2026-11", today: "2026-11-13", bills: [], payments: [], accounts: [], categories: [], cardTxs: [], cardTxsIncomplete: true,
    });
    expect(d.incompleto).toBe(true);
  });
});
