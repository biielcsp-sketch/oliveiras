/**
 * Regras de concorrência da Casa (dois celulares mexendo ao mesmo tempo), separadas do Supabase para teste.
 * Cada operação recebe um "repo" com leituras e gravações CONDICIONAIS (só gravam se o estado ainda é o esperado);
 * em actions.ts o repo é o Supabase com a sessão do usuário (RLS) e `.eq(...)` nas condições.
 */
import { advanceRotation, completeChore as completeCalc, type ChoreSchedule } from "./schedule";

type Fail = { ok: false; erro: string };

/* ---------- Quantidade da despensa (+/−, repor) ---------- */

export type QtyRow = { quantity: number; min_quantity: number };
export type QtyRepo<R extends QtyRow> = {
  read(): Promise<R | null>;
  /** Grava `next` só se a quantidade ainda for `expected`. null = ninguém casou (mudou no meio); "error" = falha. */
  writeIf(expected: number, next: number): Promise<R | null | "error">;
};

export const MAX_QTY_ATTEMPTS = 3;

/** Soma `delta` (nunca abaixo de 0) com controle otimista: relê e tenta de novo se outro aparelho gravou no meio. */
export async function changeQuantityWith<R extends QtyRow>(repo: QtyRepo<R>, delta: number, max: number): Promise<{ ok: true; row: R; before: number } | Fail> {
  for (let i = 0; i < MAX_QTY_ATTEMPTS; i++) {
    const cur = await repo.read();
    if (!cur) return { ok: false, erro: "Item não encontrado." };
    const before = Number(cur.quantity);
    const after = Math.max(0, Math.round((before + delta) * 100) / 100);
    if (after > max) return { ok: false, erro: "Quantidade inválida." };
    if (after === before) return { ok: true, row: cur, before };
    const w = await repo.writeIf(before, after);
    if (w === "error") return { ok: false, erro: "Não foi possível atualizar." };
    if (w) return { ok: true, row: w, before };
  }
  return { ok: false, erro: "O item mudou em outro aparelho. Tente de novo." };
}

/* ---------- Lista de compras: marcar comprado e repor ---------- */

export type ToggleRow = { name: string; quantity: number | null; unit: string | null; pantry_item_id: string | null };
export type ToggleRepo = {
  /** Muda `done` só se ainda estiver no valor oposto. null = nada mudou; { code } = erro do banco. */
  updateIf(done: boolean): Promise<ToggleRow | null | { code?: string }>;
  exists(): Promise<boolean>;
};

/**
 * Marca/desmarca uma vez só: se o outro aparelho já marcou, `changed` = false (sem sugestão de repor duplicada).
 * `row` só vem quando esta chamada mudou a linha.
 */
export async function toggleOnce(repo: ToggleRepo, done: boolean, errorMessage: (code?: string) => string): Promise<{ ok: true; changed: boolean; row?: ToggleRow } | Fail> {
  const r = await repo.updateIf(done);
  if (r && "code" in r) return { ok: false, erro: errorMessage(r.code) };
  if (r) return { ok: true, changed: true, row: r as ToggleRow };
  return (await repo.exists()) ? { ok: true, changed: false } : { ok: false, erro: "Item não encontrado." };
}

export type RestockRepo = {
  /** Item da lista: precisa estar comprado e ainda ligado à despensa. */
  readItem(): Promise<{ done: boolean; pantry_item_id: string | null } | null>;
  /** Desliga o item da despensa só se ainda estiver ligado a `pantryId`. true = esta chamada desligou. */
  unlinkIf(pantryId: string): Promise<boolean | "error">;
  relink(pantryId: string): Promise<void>;
  add(pantryId: string, qty: number): Promise<{ ok: boolean; erro?: string }>;
};

/**
 * Repor na despensa uma vez por item da lista: quem desligar o vínculo primeiro soma; o segundo não soma de novo.
 * Se a soma falhar, o vínculo volta (dá para tentar outra vez).
 */
export async function restockOnce(repo: RestockRepo, qty: number): Promise<{ ok: true } | Fail> {
  const item = await repo.readItem();
  if (!item) return { ok: false, erro: "Item não encontrado." };
  if (!item.done || !item.pantry_item_id) return { ok: false, erro: "Este item já foi reposto." };
  const pantryId = item.pantry_item_id;
  const unlinked = await repo.unlinkIf(pantryId);
  if (unlinked === "error") return { ok: false, erro: "Não foi possível repor." };
  if (!unlinked) return { ok: false, erro: "Este item já foi reposto." };
  const r = await repo.add(pantryId, qty);
  if (!r.ok) {
    await repo.relink(pantryId);
    return { ok: false, erro: r.erro ?? "Não foi possível repor." };
  }
  return { ok: true };
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
