import { containsWords, normalizeText } from "./rules";

export type TransferKind = "transferencia" | "cartao";

export type PairTx = {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: number;
  category_id: string | null;
  category_source?: string | null;
  transfer_group?: string | null;
  transfer_checked?: boolean;
};

export type Pair = { outId: string; inId: string; kind: TransferKind };
export type ReviewItem = Pair & { reason: "ambiguo" | "categoria" };

/** Categoria que o pareamento automático pode trocar sem perder escolha do usuário. */
const AUTO_SOURCES = new Set(["regra", "historico", "pluggy", "par"]);

export const TRANSFER_CATEGORY_NAME: Record<TransferKind, string> = {
  transferencia: "Transferência entre contas",
  cartao: "Pagamento Cartão de Crédito",
};

function daysBetween(a: string, b: string) {
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
}

/** Primeiros nomes da família, normalizados, com 3+ letras. */
export function firstNames(memberNames: string[]) {
  return [...new Set(memberNames.map((n) => normalizeText(n).split(/[^a-z]+/).find(Boolean) ?? "").filter((n) => n.length >= 3))];
}

/** Tipo do par se as duas pernas parecem transferência/pagamento de cartão; senão null. Valor igual sozinho não basta. */
export function pairKind(
  out: PairTx,
  inn: PairTx,
  kindOf: (accountId: string) => string | undefined,
  names: string[],
): TransferKind | null {
  if (out.amount >= 0 || inn.amount <= 0) return null;
  if (out.account_id === inn.account_id) return null;
  if (Math.round(-out.amount * 100) !== Math.round(inn.amount * 100)) return null;
  const outCard = kindOf(out.account_id) === "cartao";
  const inCard = kindOf(inn.account_id) === "cartao";
  const gap = daysBetween(out.date, inn.date);
  if (inCard && !outCard) {
    if (gap > 3) return null;
    const ok = containsWords(out.description, "fatura") || containsWords(out.description, "cartao") || containsWords(inn.description, "pagamento");
    return ok ? "cartao" : null;
  }
  if (!inCard && !outCard) {
    if (gap > 2) return null;
    const hint = (d: string) =>
      names.some((n) => containsWords(d, n)) || containsWords(d, "mesma titularidade") || containsWords(d, "entre contas");
    return hint(out.description) || hint(inn.description) ? "transferencia" : null;
  }
  return null;
}

/**
 * Pares de transferência entre contas da família e de pagamento de fatura (corrente → cartão).
 * - Só lançamentos sem grupo e não marcados como "não é transferência".
 * - Perna com mais de um candidato do outro lado: nenhum par aplicado, tudo vai para conferência ('ambiguo').
 * - Perna com categoria escolhida pelo usuário (manual/legado) que não é de transferência: conferência ('categoria').
 */
export function findTransferPairs(
  txs: PairTx[],
  accounts: { id: string; kind: string }[],
  memberNames: string[],
  categories: { id: string; kind: string }[] = [],
): { pairs: Pair[]; review: ReviewItem[] } {
  const kindById = new Map(accounts.map((a) => [a.id, a.kind]));
  const catKind = new Map(categories.map((c) => [c.id, c.kind]));
  const names = firstNames(memberNames);
  const open = txs.filter((t) => !t.transfer_group && !t.transfer_checked);
  const outs = open.filter((t) => t.amount < 0);
  const ins = open.filter((t) => t.amount > 0);

  // Agrupa por valor para não comparar todos com todos.
  const insByCents = new Map<number, PairTx[]>();
  for (const t of ins) {
    const c = Math.round(t.amount * 100);
    insByCents.set(c, [...(insByCents.get(c) ?? []), t]);
  }
  const edges: Pair[] = [];
  for (const o of outs) {
    for (const i of insByCents.get(Math.round(-o.amount * 100)) ?? []) {
      const kind = pairKind(o, i, (id) => kindById.get(id), names);
      if (kind) edges.push({ outId: o.id, inId: i.id, kind });
    }
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.outId, (degree.get(e.outId) ?? 0) + 1);
    degree.set(e.inId, (degree.get(e.inId) ?? 0) + 1);
  }
  const byId = new Map(open.map((t) => [t.id, t]));
  const free = (t: PairTx) =>
    !t.category_id || AUTO_SOURCES.has(t.category_source ?? "") || catKind.get(t.category_id) === "transferencia";

  const pairs: Pair[] = [];
  const review: ReviewItem[] = [];
  for (const e of edges) {
    if ((degree.get(e.outId) ?? 0) > 1 || (degree.get(e.inId) ?? 0) > 1) review.push({ ...e, reason: "ambiguo" });
    else if (free(byId.get(e.outId)!) && free(byId.get(e.inId)!)) pairs.push(e);
    else review.push({ ...e, reason: "categoria" });
  }
  return { pairs, review };
}

export type TxTipo = "gastos" | "transferencias" | "cartao";
export const TX_TIPOS: { value: TxTipo; label: string }[] = [
  { value: "gastos", label: "Gastos" },
  { value: "transferencias", label: "Transferências" },
  { value: "cartao", label: "Pagamento de cartão" },
];
export function parseTipo(v: string | undefined): TxTipo {
  return v === "transferencias" || v === "cartao" ? v : "gastos";
}

/** Categorias sem par que aparecem em cada aba (pelo nome padrão, kind transferência). */
const UNPAIRED_NAMES: Record<Exclude<TxTipo, "gastos">, string[]> = {
  transferencias: ["Transferência entre contas", "Aplicação e resgate"],
  cartao: ["Pagamento Cartão de Crédito"],
};

export type ShownPair<T> = { group: string; out: T; in: T; kind: TransferKind; date: string; amount: number };

/**
 * Separa os lançamentos de Lançamentos por aba:
 * - gastos: sem par e com categoria que não é de transferência (ou sem categoria);
 * - transferencias / cartao: pares do tipo (uma linha por par; `legs` completa a perna que o filtro não trouxe)
 *   e lançamentos sem par com as categorias de transferência daquela aba.
 */
export function splitByTipo<T extends PairTx>(
  tipo: TxTipo,
  txs: T[],
  categories: { id: string; name: string; kind: string }[],
  accounts: { id: string; kind: string }[],
  legs: T[] = [],
): { rows: T[]; pairs: ShownPair<T>[] } {
  const catById = new Map(categories.map((c) => [c.id, c]));
  if (tipo === "gastos") {
    return {
      rows: txs.filter((t) => !t.transfer_group && catById.get(t.category_id ?? "")?.kind !== "transferencia"),
      pairs: [],
    };
  }
  const kindOf = new Map(accounts.map((a) => [a.id, a.kind]));
  const byGroup = new Map<string, T[]>();
  for (const t of [...txs, ...legs]) {
    if (!t.transfer_group) continue;
    const list = byGroup.get(t.transfer_group) ?? [];
    if (!list.some((x) => x.id === t.id)) list.push(t);
    byGroup.set(t.transfer_group, list);
  }
  const pairs: ShownPair<T>[] = [];
  const shownGroups = new Set(txs.map((t) => t.transfer_group).filter(Boolean) as string[]);
  for (const g of shownGroups) {
    const list = byGroup.get(g) ?? [];
    const out = list.find((t) => t.amount < 0);
    const inn = list.find((t) => t.amount > 0);
    if (!out || !inn) continue;
    const kind: TransferKind = kindOf.get(inn.account_id) === "cartao" && kindOf.get(out.account_id) !== "cartao" ? "cartao" : "transferencia";
    if ((tipo === "cartao") !== (kind === "cartao")) continue;
    pairs.push({ group: g, out, in: inn, kind, date: out.date, amount: inn.amount });
  }
  pairs.sort((a, b) => b.date.localeCompare(a.date));
  const names = new Set(UNPAIRED_NAMES[tipo]);
  const rows = txs.filter((t) => {
    if (t.transfer_group) return false;
    const c = catById.get(t.category_id ?? "");
    return c?.kind === "transferencia" && names.has(c.name);
  });
  return { rows, pairs };
}
