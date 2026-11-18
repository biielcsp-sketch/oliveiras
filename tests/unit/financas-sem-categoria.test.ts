// Regressão: "Sem categoria" escolhido pelo usuário (category_id null + category_source 'manual') era
// preenchido de novo pela sincronização, pelas regras e pelos pares; depois de "Separar" a próxima
// sincronização recolocava 'Pagamento Cartão de Crédito'. Editar uma perna 'par' sem mudar a categoria
// virava 'manual'.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));

type Row = Record<string, unknown> & { id: string };
const db: Record<string, Row[]> = {};
const ACC = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const TX = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";

function fakeFrom(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Record<string, unknown> | null = null;
  let single = false;
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => (c === "household_id" ? b : (filters.push((r) => r[c] === v), b));
  b.is = (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), b);
  b.not = (c: string) => (filters.push((r) => (r[c] ?? null) !== null), b);
  b.in = (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b);
  b.gte = () => b;
  b.order = () => b;
  b.range = (a: number) => (a > 0 ? (filters.push(() => false), b) : b);
  b.update = (p: Record<string, unknown>) => ((patch = p), b);
  b.maybeSingle = () => ((single = true), b);
  b.then = (resolve: (v: unknown) => unknown) => {
    const rows = (db[table] ??= []);
    const match = rows.filter((r) => filters.every((f) => f(r)));
    if (patch) match.forEach((r) => Object.assign(r, patch));
    return Promise.resolve({ data: single ? (match[0] ?? null) : match, error: null }).then(resolve);
  };
  return b;
}
const client = { from: fakeFrom };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/data", () => ({ getAppContext: async () => ({ household: { id: "h1" } }) }));

const { applyRules, saveTransaction } = await import("@/app/(app)/financas/actions");
const { unlinkPair } = await import("@/app/(app)/financas/transfer-actions");
const { writePair } = await import("@/lib/financas/transfers-data");
const { planSync } = await import("@/lib/pluggy/normalize");

const byId = (id: string) => db.fin_transactions.find((t) => t.id === id)!;

beforeEach(() => {
  db.fin_rules = [{ id: "r1", pattern: "padaria", category_id: CAT }];
  db.fin_categories = [{ id: "cartao", name: "Pagamento Cartão de Crédito", kind: "transferencia" }];
  db.fin_transactions = [];
});

describe("'Sem categoria' escolhido não é preenchido de novo", () => {
  it("Separar grava null + 'manual'", async () => {
    db.fin_transactions = [
      { id: "a", transfer_group: GROUP, category_id: "cartao", category_source: "par" },
      { id: "b", transfer_group: GROUP, category_id: "cartao", category_source: "par" },
    ];
    await unlinkPair(GROUP);
    expect(byId("a")).toMatchObject({ transfer_group: null, transfer_checked: true, category_id: null, category_source: "manual" });
  });

  it("sincronização não preenche categoria de linha null + 'manual' (preenche a null + null)", () => {
    const incoming = { external_id: "k", date: "2026-11-01", amount: -10, description: "PAG FATURA", category_id: "cartao", category_source: "regra" as const, pluggy_category: null };
    const plan = planSync(
      [
        { id: "m", external_id: "k", date: "2026-11-01", amount: -10, description: "PAG FATURA", category_id: null, category_source: "manual", pluggy_category: null },
        { id: "n", external_id: "k2", date: "2026-11-01", amount: -10, description: "PAG FATURA", category_id: null, category_source: null, pluggy_category: null },
      ],
      [incoming, { ...incoming, external_id: "k2" }],
    );
    expect(plan.fills).toEqual([{ id: "n", category: { category_id: "cartao", category_source: "regra" } }]);
  });

  it("aplicar regras pula null + 'manual'", async () => {
    db.fin_transactions = [
      { id: "m", description: "PADARIA SOL", category_id: null, category_source: "manual" },
      { id: "n", description: "PADARIA SOL", category_id: null, category_source: null },
    ];
    const r = await applyRules();
    expect(r.updated).toBe(1);
    expect(byId("m").category_id).toBeNull();
    expect(byId("n")).toMatchObject({ category_id: CAT, category_source: "regra" });
  });

  it("par automático não põe categoria em perna null + 'manual'", async () => {
    db.fin_transactions = [
      { id: "o", category_id: null, category_source: "manual", transfer_group: null },
      { id: "i", category_id: null, category_source: null, transfer_group: null },
    ];
    await writePair(client as never, "h1", db.fin_transactions.map((t) => ({ id: t.id, category_id: null, category_source: t.category_source as string | null })), db.fin_categories as never, "cartao");
    expect(byId("o")).toMatchObject({ category_id: null, category_source: "manual" });
    expect(byId("i")).toMatchObject({ category_id: "cartao", category_source: "par" });
    expect(byId("o").transfer_group).toBe(byId("i").transfer_group);
  });
});

describe("saveTransaction: origem só vira 'manual' quando a categoria muda", () => {
  const form = (category: string) => {
    const f = new FormData();
    f.set("id", TX);
    f.set("account_id", ACC);
    f.set("description", "PAG FATURA");
    f.set("amount", "10,00");
    f.set("date", "2026-11-10");
    f.set("direction", "saida");
    f.set("category_id", category);
    return f;
  };

  it("sem mudança: perna 'par' continua 'par'", async () => {
    db.fin_transactions = [{ id: TX, category_id: CAT, category_source: "par" }];
    await expect(saveTransaction(null, form(CAT))).rejects.toThrow("REDIRECT");
    expect(byId(TX).category_source).toBe("par");
  });

  it("limpou a categoria: null + 'manual'", async () => {
    db.fin_transactions = [{ id: TX, category_id: CAT, category_source: "regra" }];
    await expect(saveTransaction(null, form(""))).rejects.toThrow("REDIRECT");
    expect(byId(TX)).toMatchObject({ category_id: null, category_source: "manual" });
  });
});
