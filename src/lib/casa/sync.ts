/**
 * Regras de concorrência da Casa (dois celulares mexendo ao mesmo tempo), separadas do Supabase para teste.
 * Cada operação recebe um "repo" com leituras e gravações CONDICIONAIS (só gravam se o estado ainda é o esperado);
 * em actions.ts o repo é o Supabase com a sessão do usuário (RLS) e `.eq(...)` nas condições.
 */
import { advanceRotation, completeChore as completeCalc, type ChoreSchedule } from "./schedule";

type Fail = { ok: false; erro: string };

/* ---------- Lista de compras: marcar comprado ---------- */

export type ToggleRepo = {
  /** Muda `done` só se ainda estiver no valor oposto. true = esta chamada mudou; false = nada mudou; { code } = erro do banco. */
  updateIf(done: boolean): Promise<boolean | { code?: string }>;
  exists(): Promise<boolean>;
};

/** Marca/desmarca uma vez só: se o outro aparelho já marcou, `changed` = false (sem erro na tela). */
export async function toggleOnce(repo: ToggleRepo, done: boolean): Promise<{ ok: true; changed: boolean } | Fail> {
  const r = await repo.updateIf(done);
  if (typeof r === "object") return { ok: false, erro: "Não foi possível atualizar." };
  if (r) return { ok: true, changed: true };
  return (await repo.exists()) ? { ok: true, changed: false } : { ok: false, erro: "Item não encontrado." };
}

/* ---------- Tarefas: Feita e pular a vez ---------- */

export type ChoreState = ChoreSchedule & { id: string; rotation: string[]; next_index: number; next_due_on: string | null };
export type Expected = { next_index: number; next_due_on: string | null };
export type ChoreRepo = {
  read(): Promise<ChoreState | null>;
  /** Atualiza só se índice e data ainda forem `expected`. true = esta chamada atualizou; { code } = erro. */
  updateIf(expected: Expected, patch: Expected): Promise<boolean | { code?: string }>;
  insertLog(row: { member_id: string | null; done_on: string }): Promise<boolean>;
};

export const STALE_CHORE = "A tarefa já foi atualizada em outro aparelho.";

const same = (c: Expected, e: Expected) => c.next_index === e.next_index && (c.next_due_on ?? null) === (e.next_due_on ?? null);

/**
 * "Feita" com o estado que a tela mostrou (`expected`): se outro aparelho já marcou, não avança de novo.
 * Ordem: avança (condicional) e grava o histórico; se o histórico falhar, desfaz o avanço (também condicional),
 * para nunca ficar avanço sem registro.
 */
export async function completeChoreWith(repo: ChoreRepo, expected: Expected, today: string, valid: ReadonlySet<string>, dbError: (code?: string) => string): Promise<{ ok: true } | Fail> {
  const c = await repo.read();
  if (!c) return { ok: false, erro: "Tarefa não encontrada." };
  if (!same(c, expected)) return { ok: false, erro: STALE_CHORE };
  const r = completeCalc(c, today, valid);
  const next = { next_index: r.next_index, next_due_on: r.next_due_on };
  const u = await repo.updateIf(expected, next);
  if (typeof u === "object") return { ok: false, erro: dbError(u.code) };
  if (!u) return { ok: false, erro: STALE_CHORE };
  if (!(await repo.insertLog({ member_id: r.member_id, done_on: r.done_on }))) {
    await repo.updateIf(next, expected);
    return { ok: false, erro: "Não foi possível registrar a tarefa. Tente de novo." };
  }
  return { ok: true };
}

/** "Pular a vez": passa para o próximo válido, só se a tela ainda mostrava o estado atual. */
export async function skipChoreWith(repo: ChoreRepo, expected: Expected, valid: ReadonlySet<string>, dbError: (code?: string) => string): Promise<{ ok: true } | Fail> {
  const c = await repo.read();
  if (!c) return { ok: false, erro: "Tarefa não encontrada." };
  if (!same(c, expected)) return { ok: false, erro: STALE_CHORE };
  if (new Set(c.rotation.filter((m) => valid.has(m))).size < 2) return { ok: false, erro: "Só há uma pessoa no rodízio." };
  const u = await repo.updateIf(expected, { next_index: advanceRotation(c, valid), next_due_on: c.next_due_on });
  if (typeof u === "object") return { ok: false, erro: dbError(u.code) };
  return u ? { ok: true } : { ok: false, erro: STALE_CHORE };
}
