// "Usar para os próximos parecidos": salvar com a caixa marcada cria a regra (texto = cleanDescription)
// e categoriza os parecidos que estão sem categoria; a categoria escolhida grava category_source 'manual'.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let redirectedTo = "";
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectedTo = url;
    throw new Error("REDIRECT");
  },
}));

type Row = Record<string, unknown> & { id: string };
const db: Record<string, Row[]> = {};
const ACC = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const TX = "33333333-3333-4333-8333-333333333333";

function fakeFrom(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Record<string, unknown> | null = null;
  let insert: Record<string, unknown> | null = null;
  let single = false;
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => (c === "household_id" ? b : (filters.push((r) => r[c] === v), b));
  b.is = (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), b);
  b.in = (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b);
  b.order = () => b;
  b.range = () => b;
  b.update = (p: Record<string, unknown>) => ((patch = p), b);
  b.insert = (p: Record<string, unknown>) => ((insert = p), b);
  b.maybeSingle = () => ((single = true), b);
  b.then = (resolve: (v: unknown) => unknown) => {
    const rows = (db[table] ??= []);
    if (insert) {
      rows.push({ id: `new${rows.length}`, ...insert });
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    const match = rows.filter((r) => filters.every((f) => f(r)));
    if (patch) match.forEach((r) => Object.assign(r, patch));
    return Promise.resolve({ data: single ? (match[0] ?? null) : match, error: null }).then(resolve);
  };
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fakeFrom }) }));
vi.mock("@/lib/data", () => ({ getAppContext: async () => ({ household: { id: "h1" } }) }));
vi.mock("@/lib/financas/transfers-data", () => ({ loadCategorizeCtx: async () => ({}), runLinkTransfers: async () => ({}) }));

const { saveTransaction } = await import("@/app/(app)/financas/actions");

function form(learn: boolean) {
  const f = new FormData();
  f.set("id", TX);
  f.set("account_id", ACC);
  f.set("description", "COMPRA ELO DEBITO VISTA - PADARIA SOL 12/03");
  f.set("amount", "12,50");
  f.set("date", "2026-11-10");
  f.set("direction", "saida");
  f.set("category_id", CAT);
  if (learn) f.set("learn", "on");
  return f;
}

beforeEach(() => {
  redirectedTo = "";
  db.fin_rules = [];
  db.fin_transactions = [
    { id: TX, description: "PADARIA SOL", category_id: null },
    { id: "p2", description: "Padaria Sol 15/03", category_id: null },
    { id: "p3", description: "PADARIA SOL", category_id: "outra" },
    { id: "p4", description: "Mercado", category_id: null },
  ];
});

describe("aprender com correção", () => {
  it("com a caixa marcada: cria regra 'padaria sol', categoriza só os parecidos sem categoria e avisa", async () => {
    await expect(saveTransaction(null, form(true))).rejects.toThrow("REDIRECT");
    expect(db.fin_rules).toMatchObject([{ pattern: "padaria sol", category_id: CAT }]);
    const byId = Object.fromEntries(db.fin_transactions.map((t) => [t.id, t]));
    expect(byId[TX]).toMatchObject({ category_id: CAT, category_source: "manual" });
    expect(byId.p2).toMatchObject({ category_id: CAT, category_source: "regra" });
    expect(byId.p3.category_id).toBe("outra");
    expect(byId.p4.category_id).toBeNull();
    expect(redirectedTo).toBe("/financas/lancamentos?mes=2026-11&aprendeu=1");
  });

  it("regra com o mesmo texto já existe: troca a categoria dela", async () => {
    db.fin_rules = [{ id: "r1", pattern: "padaria sol", category_id: "antiga" }];
    await expect(saveTransaction(null, form(true))).rejects.toThrow("REDIRECT");
    expect(db.fin_rules).toEqual([{ id: "r1", pattern: "padaria sol", category_id: CAT }]);
  });

  it("sem a caixa: não cria regra nem mexe nos outros", async () => {
    await expect(saveTransaction(null, form(false))).rejects.toThrow("REDIRECT");
    expect(db.fin_rules).toEqual([]);
    expect(db.fin_transactions.find((t) => t.id === "p2")!.category_id).toBeNull();
    expect(redirectedTo).toBe("/financas/lancamentos?mes=2026-11");
  });
});
