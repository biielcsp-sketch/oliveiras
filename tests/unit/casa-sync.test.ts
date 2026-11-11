import { describe, expect, it } from "vitest";
import {
  changeQuantityWith,
  completeChoreWith,
  restockOnce,
  skipChoreWith,
  STALE_CHORE,
  toggleOnce,
  type ChoreRepo,
  type ChoreState,
  type Expected,
  type QtyRepo,
  type RestockRepo,
  type ToggleRepo,
  type ToggleRow,
} from "@/lib/casa/sync";

/** Cede a vez ao event loop: com Promise.all, as duas chamadas leem antes de qualquer uma gravar (dois celulares). */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const valid = new Set([A, B]);
const dbErr = (c?: string) => `erro ${c}`;

/* ---------- fakes em memória com a mesma semântica dos updates condicionais do Supabase ---------- */

function pantryStore(quantity: number, min = 1) {
  const row = { quantity, min_quantity: min };
  const repo: QtyRepo<typeof row> = {
    async read() {
      const snap = { ...row };
      await tick();
      return snap;
    },
    async writeIf(expected, next) {
      await tick();
      if (row.quantity !== expected) return null;
      row.quantity = next;
      return { ...row };
    },
  };
  return { row, repo };
}

function choreStore(init: Partial<ChoreState> = {}) {
  const chore: ChoreState = { id: "c", frequency: "diaria", weekdays: null, month_day: null, rotation: [A, B], next_index: 0, next_due_on: "2026-11-10", ...init };
  const logs: { member_id: string | null; done_on: string }[] = [];
  let failLog = false;
  const repo: ChoreRepo = {
    async read() {
      const snap = { ...chore };
      await tick();
      return snap;
    },
    async updateIf(expected, patch) {
      await tick();
      if (chore.next_index !== expected.next_index || chore.next_due_on !== expected.next_due_on) return false;
      Object.assign(chore, patch);
      return true;
    },
    async insertLog(row) {
      await tick();
      if (failLog) return false;
      logs.push(row);
      return true;
    },
  };
  return { chore, logs, repo, failNextLog: () => (failLog = true) };
}

function shoppingStore(done: boolean, pantryId: string | null) {
  const item = { done, pantry_item_id: pantryId, name: "Café", quantity: 2 as number | null, unit: null as string | null };
  const toggleRepo: ToggleRepo = {
    async updateIf(target) {
      await tick();
      if (item.done !== !target) return null;
      item.done = target;
      return { ...item } as ToggleRow;
    },
    async exists() {
      return true;
    },
  };
  return { item, toggleRepo };
}

describe("concorrência: +/− da despensa", () => {
  it("dois aparelhos ao mesmo tempo não perdem mudança (−1 e −1 = −2)", async () => {
    const { row, repo } = pantryStore(5);
    const [r1, r2] = await Promise.all([changeQuantityWith(repo, -1, 99999), changeQuantityWith(repo, -1, 99999)]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(row.quantity).toBe(3);
  });
  it("+1 e −1 simultâneos voltam ao valor inicial; nunca abaixo de zero", async () => {
    const s = pantryStore(1);
    await Promise.all([changeQuantityWith(s.repo, 1, 99999), changeQuantityWith(s.repo, -1, 99999)]);
    expect(s.row.quantity).toBe(1);
    const z = pantryStore(0);
    const r = await changeQuantityWith(z.repo, -1, 99999);
    expect(r).toMatchObject({ ok: true, before: 0 });
    expect(z.row.quantity).toBe(0);
  });
  it("desiste depois de 3 tentativas se o valor muda sempre", async () => {
    let q = 1;
    const repo: QtyRepo<{ quantity: number; min_quantity: number }> = {
      read: async () => ({ quantity: q, min_quantity: 0 }),
      writeIf: async () => {
        q++;
        return null;
      },
    };
    expect(await changeQuantityWith(repo, 1, 99999)).toEqual({ ok: false, erro: "O item mudou em outro aparelho. Tente de novo." });
  });
});

describe("concorrência: marcar comprado e repor", () => {
  it("marcar comprado duas vezes: só uma chamada muda a linha (só ela devolve a sugestão de repor)", async () => {
    const { toggleRepo } = shoppingStore(false, "p1");
    const [r1, r2] = await Promise.all([toggleOnce(toggleRepo, true, dbErr), toggleOnce(toggleRepo, true, dbErr)]);
    const changed = [r1, r2].filter((r) => r.ok && r.changed);
    expect(changed).toHaveLength(1);
    expect([r1, r2].every((r) => r.ok)).toBe(true); // o segundo não vê erro
  });
  it("erro do banco vira mensagem (23505 ao desmarcar)", async () => {
    const repo: ToggleRepo = { updateIf: async () => ({ code: "23505" }), exists: async () => true };
    expect(await toggleOnce(repo, false, (c) => (c === "23505" ? "Este item já está na lista." : "x"))).toEqual({ ok: false, erro: "Este item já está na lista." });
    const gone: ToggleRepo = { updateIf: async () => null, exists: async () => false };
    expect(await toggleOnce(gone, true, dbErr)).toEqual({ ok: false, erro: "Item não encontrado." });
  });

  function restockRepo(item: { done: boolean; pantry_item_id: string | null }, pantry: ReturnType<typeof pantryStore>, failAdd = false): RestockRepo {
    return {
      async readItem() {
        const snap = { ...item };
        await tick();
        return snap;
      },
      async unlinkIf(pantryId) {
        await tick();
        if (!item.done || item.pantry_item_id !== pantryId) return false;
        item.pantry_item_id = null;
        return true;
      },
      async relink(pantryId) {
        if (item.pantry_item_id === null) item.pantry_item_id = pantryId;
      },
      add: async (_id, qty) => (failAdd ? { ok: false, erro: "falhou" } : changeQuantityWith(pantry.repo, qty, 99999)),
    };
  }

  it("repor duas vezes ao mesmo tempo soma uma vez só", async () => {
    const pantry = pantryStore(0);
    const item = { done: true, pantry_item_id: "p1" as string | null };
    const repo = restockRepo(item, pantry);
    const [r1, r2] = await Promise.all([restockOnce(repo, 3), restockOnce(repo, 3)]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toEqual({ ok: false, erro: "Este item já foi reposto." });
    expect(pantry.row.quantity).toBe(3);
    expect(item.pantry_item_id).toBeNull();
    // Repetir depois também não soma.
    expect((await restockOnce(repo, 3)).ok).toBe(false);
    expect(pantry.row.quantity).toBe(3);
  });
  it("se a soma falhar, o vínculo volta para tentar de novo; item não comprado não repõe", async () => {
    const pantry = pantryStore(0);
    const item = { done: true, pantry_item_id: "p1" as string | null };
    expect(await restockOnce(restockRepo(item, pantry, true), 2)).toEqual({ ok: false, erro: "falhou" });
    expect(item.pantry_item_id).toBe("p1");
    expect((await restockOnce(restockRepo(item, pantry), 2)).ok).toBe(true);
    expect(pantry.row.quantity).toBe(2);
    const pending = { done: false, pantry_item_id: "p1" as string | null };
    expect((await restockOnce(restockRepo(pending, pantry), 2)).ok).toBe(false);
  });
});

describe("concorrência: tarefas (Feita e pular a vez)", () => {
  const shown: Expected = { next_index: 0, next_due_on: "2026-11-10" };

  it("Feita disparada duas vezes com o mesmo estado avança uma vez e grava um histórico", async () => {
    const s = choreStore();
    const [r1, r2] = await Promise.all([
      completeChoreWith(s.repo, shown, "2026-11-10", valid, dbErr),
      completeChoreWith(s.repo, shown, "2026-11-10", valid, dbErr),
    ]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toEqual({ ok: false, erro: STALE_CHORE });
    expect(s.chore).toMatchObject({ next_index: 1, next_due_on: "2026-11-11" });
    expect(s.logs).toEqual([{ member_id: A, done_on: "2026-11-10" }]);
  });
  it("Feita com a tela desatualizada (outro aparelho já marcou) não avança de novo", async () => {
    const s = choreStore();
    expect((await completeChoreWith(s.repo, shown, "2026-11-10", valid, dbErr)).ok).toBe(true);
    expect(await completeChoreWith(s.repo, shown, "2026-11-10", valid, dbErr)).toEqual({ ok: false, erro: STALE_CHORE });
    expect(s.chore.next_index).toBe(1);
    expect(s.logs).toHaveLength(1);
  });
  it("se o histórico falhar, desfaz o avanço (nada de avanço sem registro)", async () => {
    const s = choreStore();
    s.failNextLog();
    const r = await completeChoreWith(s.repo, shown, "2026-11-10", valid, dbErr);
    expect(r).toEqual({ ok: false, erro: "Não foi possível registrar a tarefa. Tente de novo." });
    expect(s.chore).toMatchObject({ next_index: 0, next_due_on: "2026-11-10" });
    expect(s.logs).toEqual([]);
  });
  it("erro do trigger vira mensagem clara", async () => {
    const s = choreStore();
    const repo: ChoreRepo = { ...s.repo, updateIf: async () => ({ code: "23514" }) };
    expect(await completeChoreWith(repo, shown, "2026-11-10", valid, dbErr)).toEqual({ ok: false, erro: "erro 23514" });
  });
  it("pular a vez duas vezes com o mesmo estado passa uma vez só", async () => {
    const s = choreStore();
    const [r1, r2] = await Promise.all([skipChoreWith(s.repo, shown, valid, dbErr), skipChoreWith(s.repo, shown, valid, dbErr)]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect(s.chore).toMatchObject({ next_index: 1, next_due_on: "2026-11-10" });
    expect(s.logs).toEqual([]);
  });
  it("pular com uma pessoa válida só é recusado", async () => {
    const s = choreStore({ rotation: [A] });
    expect(await skipChoreWith(s.repo, shown, valid, dbErr)).toEqual({ ok: false, erro: "Só há uma pessoa no rodízio." });
  });
});
