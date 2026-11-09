/**
 * Carteirinhas offline. DECISÃO DO DONO: só o arquivo da carteirinha (PDF/JPG) e o mínimo para
 * identificá-la (operadora, pessoa, número) ficam no aparelho, num cache dedicado.
 * Consultas, exames e páginas HTML nunca entram aqui.
 *
 * A lógica roda no navegador (janela) com a Cache API; o service worker só serve desse cache
 * quando a rede falha (public/sw.js). O cache é apagado ao sair da conta, ao entrar outro usuário
 * e ao apagar a carteirinha. Os metadados ficam DENTRO do mesmo cache (uma entrada JSON), então
 * apagar o cache apaga tudo de uma vez.
 */
export const CARDS_CACHE = "oliveiras-carteirinhas-v1";
export const META_URL = "/__offline/carteirinhas.json";
export const fileUrl = (id: string) => `/saude/arquivo/carteirinhas/${id}`;

export type OfflineCard = {
  id: string;
  operator: string;
  person: string;
  number: string | null;
  mime: "application/pdf" | "image/jpeg";
  /** updated_at da carteirinha: se mudou, baixa de novo. */
  updatedAt: string;
};
export type OfflineMeta = { userId: string; cards: OfflineCard[] };

/** Subconjunto da Cache API que usamos (facilita testar com um falso). */
export type CacheLike = {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
};
export type StorageLike = { open(name: string): Promise<CacheLike>; delete(name: string): Promise<boolean> };
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Pura: o que fazer, dado o que já está guardado e a lista atual de carteirinhas. */
export function planSync(meta: OfflineMeta | null, userId: string, cards: OfflineCard[]) {
  const wipe = meta !== null && meta.userId !== userId;
  const existing = wipe || !meta ? [] : meta.cards;
  const keep = new Map(existing.map((c) => [c.id, c]));
  const wanted = new Set(cards.map((c) => c.id));
  return {
    wipe,
    remove: existing.filter((c) => !wanted.has(c.id)).map((c) => c.id),
    /** Novas ou alteradas (a presença do arquivo no cache é conferida na hora). */
    changed: cards.filter((c) => keep.get(c.id)?.updatedAt !== c.updatedAt).map((c) => c.id),
  };
}

export async function readMeta(storage: StorageLike): Promise<OfflineMeta | null> {
  try {
    const cache = await storage.open(CARDS_CACHE);
    const res = await cache.match(META_URL);
    if (!res) return null;
    const data = (await res.json()) as OfflineMeta;
    return typeof data?.userId === "string" && Array.isArray(data.cards) ? data : null;
  } catch {
    return null;
  }
}

/** Apaga arquivos e metadados deste aparelho. */
export async function clearOfflineCards(storage: StorageLike) {
  try {
    await storage.delete(CARDS_CACHE);
  } catch {
    /* sem Cache API: nada guardado */
  }
}

/** Outro usuário entrou neste aparelho: apaga o que era do anterior. */
export async function guardOwner(storage: StorageLike, userId: string) {
  const meta = await readMeta(storage);
  if (meta && meta.userId !== userId) await clearOfflineCards(storage);
}

export async function removeOfflineCard(storage: StorageLike, id: string) {
  const meta = await readMeta(storage);
  if (!meta) return;
  const cache = await storage.open(CARDS_CACHE);
  await cache.delete(fileUrl(id));
  await writeMeta(cache, { ...meta, cards: meta.cards.filter((c) => c.id !== id) });
}

async function writeMeta(cache: CacheLike, meta: OfflineMeta) {
  await cache.put(META_URL, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
}

/** Deixa o cache igual à lista atual (substituição completa). Falha de rede não apaga o que já está guardado. */
export async function syncOfflineCards(storage: StorageLike, fetchFn: FetchLike, userId: string, cards: OfflineCard[]) {
  const plan = planSync(await readMeta(storage), userId, cards);
  if (plan.wipe) await clearOfflineCards(storage);
  const cache = await storage.open(CARDS_CACHE);
  for (const id of plan.remove) await cache.delete(fileUrl(id));

  const changed = new Set(plan.changed);
  const saved: OfflineCard[] = [];
  for (const card of cards) {
    const cached = await cache.match(fileUrl(card.id));
    if (cached && !changed.has(card.id)) {
      saved.push(card);
      continue;
    }
    try {
      const res = await fetchFn(fileUrl(card.id), { credentials: "same-origin", cache: "no-store" });
      const type = res.headers.get("content-type");
      if (!res.ok || (type !== "application/pdf" && type !== "image/jpeg")) throw new Error("download");
      await cache.put(fileUrl(card.id), res);
      saved.push(card);
    } catch {
      // Sem rede agora: mantém a versão antiga, se houver; senão fica de fora.
      if (cached) saved.push(card);
    }
  }
  await writeMeta(cache, { userId, cards: saved });
}
