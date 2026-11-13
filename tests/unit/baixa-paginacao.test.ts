// Regressão: a baixa automática lia o extrato com `.limit(5000)`, que o PostgREST corta em 1000 (max_rows).
// Um pagamento depois da posição 1000 (ordem por data) nunca chegava ao cruzamento. E, com o extrato
// incompleto, nada pode ser baixado nem sugerido (um casamento "único" pode não ser único).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const MAX_ROWS = 1000;
let db: Record<string, Row[]> = {};
let failTxRead = false;

function fakeFrom(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: string[] = [];
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  let insertRow: Row | null = null;
  const b: Record<string, unknown> = {};
  const chain = (fn: () => void) => (fn(), b);
  b.select = () => b;
  b.eq = (c: string, v: unknown) => chain(() => filters.push((r) => r[c] === v));
  b.lt = (c: string, v: string | number) => chain(() => filters.push((r) => (r[c] as string | number) < v));
  b.gte = (c: string, v: string | number) => chain(() => filters.push((r) => (r[c] as string | number) >= v));
  b.in = (c: string, vs: unknown[]) => chain(() => filters.push((r) => vs.includes(r[c])));
  b.is = (c: string, v: unknown) => chain(() => filters.push((r) => (r[c] ?? null) === v));
  b.not = (c: string, _op: string, v: unknown) => chain(() => filters.push((r) => (r[c] ?? null) !== v));
  b.order = (c: string) => chain(() => orders.push(c));
  b.limit = (n: number) => chain(() => (to = n - 1));
  b.range = (a: number, z: number) => chain(() => ((from = a), (to = z)));
  b.insert = (row: Row) => chain(() => (insertRow = row));
  b.then = (resolve: (v: unknown) => unknown) => {
    if (insertRow) {
      (db[table] ??= []).push(insertRow);
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    if (table === "fin_transactions" && failTxRead) return Promise.resolve({ data: null, error: { message: "falhou" } }).then(resolve);
    let rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (orders.length) {
      rows = [...rows].sort((x, y) => {
        for (const c of orders) {
          const d = String(x[c]).localeCompare(String(y[c]));
          if (d) return d;
        }
        return 0;
      });
    }
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null }).then(resolve);
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fakeFrom }) }));
vi.mock("@/lib/data", () => ({ getAppContext: async () => ({ household: { id: "h1" } }) }));

const { loadBaixaInput, runBaixaAutomatica, getAllBaixaSuggestions } = await import("@/lib/financas/baixa-data");

const MONTH = "2026-11";
const BILL = { id: "bill-luz", household_id: "h1", name: "Energia CPFL", amount: 187.9, due_day: 10, category_id: null, account_id: null, active: true, is_home: false };
const MATCH_TX = { id: "tx-luz", household_id: "h1", account_id: "a1", date: "2026-11-12", amount: -187.9, description: "PAG ENERGIA CPFL", source: "ofx", external_id: null };

function seed(fillers: number) {
  db = {
    fin_bills: [BILL],
    fin_transactions: [
      // Lançamentos de outubro (vêm antes na ordem por data) empurram o pagamento além da posição 1000.
      ...Array.from({ length: fillers }, (_, i) => ({
        id: `f${String(i).padStart(6, "0")}`, household_id: "h1", account_id: "a1",
        date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, amount: -1, description: `COMPRA ${i}`, source: "ofx", external_id: null,
      })),
      MATCH_TX,
    ],
    fin_bill_payments: [],
  };
}

beforeEach(() => {
  failTxRead = false;
});

describe("baixa automática com extrato grande (paginado)", () => {
  it("pagamento além da posição 1000 chega ao cruzamento e a baixa é gravada", async () => {
    seed(1200);
    const input = await loadBaixaInput([MONTH]);
    expect(input?.txs).toHaveLength(1201);
    const r = await runBaixaAutomatica([MONTH]);
    expect(r.applied.map((m) => m.transaction_id)).toEqual(["tx-luz"]);
    expect(db.fin_bill_payments).toMatchObject([{ bill_id: "bill-luz", month: MONTH, transaction_id: "tx-luz", auto: true }]);
  });

  it("sugestões da tela também enxergam o pagamento e não marcam incompleto", async () => {
    seed(1200);
    const s = await getAllBaixaSuggestions(MONTH);
    expect(s.incomplete).toBe(false);
    expect(s.fixed.map((m) => m.transaction_id)).toEqual(["tx-luz"]);
  });
});

describe("baixa automática com extrato incompleto", () => {
  it("loadBaixaInput devolve null e runBaixaAutomatica não grava nada", async () => {
    seed(10);
    failTxRead = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadBaixaInput([MONTH])).toBeNull();
    const r = await runBaixaAutomatica([MONTH]);
    expect(r).toEqual({ applied: [], appliedOneOff: [] });
    expect(db.fin_bill_payments).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("getAllBaixaSuggestions avisa a incompletude (a tela explica por que não há sugestões)", async () => {
    seed(10);
    failTxRead = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getAllBaixaSuggestions(MONTH)).toEqual({ fixed: [], oneOff: [], incomplete: true });
    errSpy.mockRestore();
  });
});
