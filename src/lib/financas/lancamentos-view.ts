import { TRANSFER_CATEGORY_NAME, type ShownPair, type TransferKind } from "./transfers";

/** Itens por "página" da lista de Lançamentos e teto de `?mostrar=`. */
export const MOSTRAR_STEP = 20;
export const MOSTRAR_MAX = 2000;

/** Valida `?mostrar=`: inteiro positivo, arredondado para cima ao múltiplo de 20, entre 20 e 2000. Inválido vira 20. */
export function parseMostrar(v: string | undefined | null): number {
  if (!v || !/^\d{1,6}$/.test(v)) return MOSTRAR_STEP;
  const n = Number(v);
  if (n < MOSTRAR_STEP) return MOSTRAR_STEP;
  return Math.min(MOSTRAR_MAX, Math.ceil(n / MOSTRAR_STEP) * MOSTRAR_STEP);
}

/** Fatia no servidor: devolve os primeiros `limit` itens e se sobrou mais. */
export function sliceVisible<T>(items: T[], limit: number): { shown: T[]; hasMore: boolean; total: number } {
  return { shown: items.slice(0, limit), hasMore: items.length > limit, total: items.length };
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function addDay(iso: string, delta: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** "Hoje", "Ontem", "12 de nov" (ou "12 de nov de 2025" em outro ano). `today` em AAAA-MM-DD. */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Hoje";
  if (iso === addDay(today, -1)) return "Ontem";
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${d} de ${MONTHS[m - 1]}`;
  return y === Number(today.slice(0, 4)) ? base : `${base} de ${y}`;
}

/** Agrupa por dia mantendo a ordem de entrada (já vem do mais recente para o mais antigo). */
export function groupByDay<T extends { date: string }>(items: T[], today: string): { date: string; label: string; items: T[] }[] {
  const groups: { date: string; label: string; items: T[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === it.date) last.items.push(it);
    else groups.push({ date: it.date, label: dayLabel(it.date, today), items: [it] });
  }
  return groups;
}

export type FeedItem<T> =
  | { type: "pair"; key: string; date: string; fatura: boolean; pair: ShownPair<T> }
  | { type: "tx"; key: string; date: string; fatura: boolean; tx: T };

/** Junta pares e lançamentos sem par numa lista só (Transferências), do mais recente para o mais antigo; marca fatura. */
export function buildTransferFeed<T extends { id: string; date: string; category_id: string | null }>(
  pairs: ShownPair<T>[],
  rows: T[],
  categories: { id: string; name: string }[],
): FeedItem<T>[] {
  const name = new Map(categories.map((c) => [c.id, c.name]));
  const feed: FeedItem<T>[] = [
    ...pairs.map((p): FeedItem<T> => ({ type: "pair", key: `p-${p.group}`, date: p.date, fatura: (p.kind as TransferKind) === "cartao", pair: p })),
    ...rows.map((t): FeedItem<T> => ({
      type: "tx",
      key: `t-${t.id}`,
      date: t.date,
      fatura: name.get(t.category_id ?? "") === TRANSFER_CATEGORY_NAME.cartao,
      tx: t,
    })),
  ];
  return feed.sort((a, b) => b.date.localeCompare(a.date)); // sort estável: mantém a ordem original no mesmo dia
}
