import { describe, expect, it } from "vitest";
import { completeChoreWith, skipChoreWith, STALE_CHORE, toggleOnce, type ChoreRepo, type ChoreState, type Expected, type ToggleRepo } from "@/lib/casa/sync";

/** Cede a vez ao event loop: com Promise.all, as duas chamadas leem antes de qualquer uma gravar (dois celulares). */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const valid = new Set([A, B]);
const dbErr = (c?: string) => `erro ${c}`;

/* ---------- fakes em memória com a mesma semântica dos updates condicionais do Supabase ---------- */

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

function shoppingStore(done: boolean) {
  const item = { done };
  const toggleRepo: ToggleRepo = {
    async updateIf(target) {
      await tick();
      if (item.done !== !target) return false;
      item.done = target;
      return true;
    },
    async exists() {
      return true;
    },
  };
  return { item, toggleRepo };
}

describe("concorrência: marcar comprado", () => {
  it("marcar comprado duas vezes ao mesmo tempo: só uma chamada muda a linha e nenhuma vê erro", async () => {
    const { item, toggleRepo } = shoppingStore(false);
    const [r1, r2] = await Promise.all([toggleOnce(toggleRepo, true), toggleOnce(toggleRepo, true)]);
    expect([r1, r2].filter((r) => r.ok && r.changed)).toHaveLength(1);
    expect([r1, r2].every((r) => r.ok)).toBe(true);
    expect(item.done).toBe(true);
  });
  it("erro do banco e item apagado viram mensagem", async () => {
    const repo: ToggleRepo = { updateIf: async () => ({ code: "42501" }), exists: async () => true };
    expect(await toggleOnce(repo, false)).toEqual({ ok: false, erro: "Não foi possível atualizar." });
    const gone: ToggleRepo = { updateIf: async () => false, exists: async () => false };
    expect(await toggleOnce(gone, true)).toEqual({ ok: false, erro: "Item não encontrado." });
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
