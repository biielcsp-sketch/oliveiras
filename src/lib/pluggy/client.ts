import "server-only";
import type { PluggyAccount, PluggyTransaction } from "./normalize";

const BASE = (process.env.PLUGGY_API_URL || "https://api.pluggy.ai").replace(/\/$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES = 40;

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function pluggyConfigured() {
  return Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
}

/** Só a família autorizada usa as credenciais da Pluggy (elas leem os itens de quem as criou). */
export function pluggyAllowedFor(householdId: string) {
  const allowed = process.env.PLUGGY_HOUSEHOLD_ID;
  return Boolean(allowed) && allowed === householdId;
}

let cached: { key: string; expiresAt: number } | null = null;

async function apiKey(force = false) {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.key;
  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new PluggyError("Credenciais da Pluggy recusadas.", res.status);
  const { apiKey: key } = (await res.json()) as { apiKey?: string };
  if (!key) throw new PluggyError("Resposta de autenticação inválida.");
  // A chave vale 2 horas; renovamos antes.
  cached = { key, expiresAt: Date.now() + 100 * 60_000 };
  return key;
}

async function get<T>(path: string): Promise<T> {
  for (const force of [false, true]) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "X-API-KEY": await apiKey(force) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if ((res.status === 401 || res.status === 403) && !force) continue;
    if (res.status === 404) throw new PluggyError("Não encontrado na Pluggy.", 404);
    if (!res.ok) throw new PluggyError(`Pluggy respondeu ${res.status}.`, res.status);
    return (await res.json()) as T;
  }
  throw new PluggyError("Acesso negado pela Pluggy.", 403);
}

function assertUuid(id: string) {
  if (!UUID.test(id)) throw new PluggyError("Identificador inválido.");
  return id;
}

export type PluggyItem = {
  id: string;
  status: string;
  consentExpiresAt?: string | null;
  connector?: { name?: string } | null;
};

export async function getItem(itemId: string) {
  return get<PluggyItem>(`/items/${assertUuid(itemId)}`);
}

export async function listAccounts(itemId: string) {
  const data = await get<{ results: PluggyAccount[] }>(`/accounts?itemId=${assertUuid(itemId)}`);
  return data.results ?? [];
}

/** Todas as transações da conta desde `dateFrom`, seguindo o cursor da v2. */
export async function listTransactions(accountId: string, dateFrom: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) throw new PluggyError("Data inválida.");
  const all: PluggyTransaction[] = [];
  let path = `/v2/transactions?accountId=${assertUuid(accountId)}&dateFrom=${dateFrom}`;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await get<{ results: PluggyTransaction[]; next?: string | null }>(path);
    all.push(...(data.results ?? []));
    if (!data.next) return all;
    // `next` é uma query string pronta; só aceitamos se for para o mesmo endpoint.
    if (!data.next.startsWith("?")) throw new PluggyError("Paginação inesperada.");
    path = `/v2/transactions${data.next}`;
  }
  throw new PluggyError("Muitas páginas de transações; reduza o período.");
}
