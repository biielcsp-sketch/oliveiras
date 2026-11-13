// Regressão: "Aplicar regras aos sem categoria" lia no máximo 1000 lançamentos (max_rows do PostgREST;
// o `.limit(5000)` não passava disso) e contava o lote inteiro como atualizado. O cliente simulado imita o
// PostgREST: nenhuma leitura passa de 1000 linhas; o update só muda o que ainda está sem categoria.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const MAX_ROWS = 1000;
type Tx = { id: string; description: string; category_id: string | null };
let txs: Tx[] = [];
let failUpdates = false;

function fakeFrom(table: string) {
  const filters: ((t: Tx) => boolean)[] = [];
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  let patch: Partial<Tx> | null = null;
  let returning = false;
  const b: Record<string, unknown> = {};
  b.select = () => {
    if (patch) returning = true;
    return b;
  };
  b.eq = () => b; // household_id: tudo é da mesma família aqui
  b.is = (col: keyof Tx, v: null) => (filters.push((t) => t[col] === v), b);
  b.in = (col: keyof Tx, vals: string[]) => (filters.push((t) => vals.includes(t[col] as string)), b);
  b.order = () => b;
  b.limit = (n: number) => ((to = n - 1), b);
  b.range = (a: number, z: number) => ((from = a), (to = z), b);
  b.update = (p: Partial<Tx>) => ((patch = p), b);
  b.then = (resolve: (v: unknown) => unknown) => {
    if (table === "fin_rules") return Promise.resolve({ data: [{ pattern: "mercado", category_id: "cat-mercado" }], error: null }).then(resolve);
    const match = txs.filter((t) => filters.every((f) => f(t)));
    if (patch) {
      if (failUpdates) return Promise.resolve({ data: null, error: { message: "falhou" } }).then(resolve);
      match.forEach((t) => Object.assign(t, patch));
      return Promise.resolve({ data: returning ? match.map((t) => ({ id: t.id })) : null, error: null }).then(resolve);
    }
    return Promise.resolve({ data: match.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null }).then(resolve);
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fakeFrom }) }));
vi.mock("@/lib/data", () => ({ getAppContext: async () => ({ household: { id: "h1" } }) }));

const { applyRules } = await import("@/app/(app)/financas/actions");

const make = (n: number, desc = "MERCADO DA ESQUINA") =>
  Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(6, "0")}`, description: `${desc} ${i}`, category_id: null }));

beforeEach(() => {
  failUpdates = false;
});

describe("applyRules (paginado)", () => {
  it("1205 sem categoria que casam com a regra: categoriza todos e conta 1205", async () => {
    txs = make(1205);
    const r = await applyRules();
    expect(r).toMatchObject({ ok: true, updated: 1205 });
    expect(r?.partial).toBeUndefined();
    expect(txs.filter((t) => t.category_id === null)).toHaveLength(0);
  });

  it("conta só o que o banco mudou (não casa = não conta)", async () => {
    txs = [...make(1100), ...make(50, "FARMACIA").map((t, i) => ({ ...t, id: `f${i}` }))];
    const r = await applyRules();
    expect(r?.updated).toBe(1100);
    expect(txs.filter((t) => t.category_id === null)).toHaveLength(50);
  });

  it("falha na gravação: não conta como atualizado e avisa parcial", async () => {
    txs = make(10);
    failUpdates = true;
    const r = await applyRules();
    expect(r).toMatchObject({ ok: true, updated: 0, partial: true });
  });
});
