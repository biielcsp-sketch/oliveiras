import "server-only";
import type { PluggyAccount, PluggyTransaction } from "./normalize";
import { PluggyError } from "./errors";
import { credentialConfigured, credentialEnvNames, credentialOwner, configuredCredentials, type PluggyCredential } from "./credentials";

const BASE = (process.env.PLUGGY_API_URL || "https://api.pluggy.ai").replace(/\/$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES = 40;

export { PluggyError } from "./errors";

export type { PluggyCredential } from "./credentials";

/** Há credencial configurada? Sem argumento, vale qualquer uma; com argumento, só aquela. */
export function pluggyConfigured(credential?: PluggyCredential) {
  return credential ? credentialConfigured(credential) : configuredCredentials().length > 0;
}

/** Credenciais com Client ID e Secret presentes no servidor (a tela só oferece estas). */
export function pluggyCredentials() {
  return configuredCredentials();
}

/** Só a família autorizada usa as credenciais da Pluggy (elas leem os itens de quem as criou). */
export function pluggyAllowedFor(householdId: string) {
  const allowed = process.env.PLUGGY_HOUSEHOLD_ID;
  return Boolean(allowed) && allowed === householdId;
}

// Um token por credencial: nunca reaproveitar o de uma aplicação para a outra.
const cached = new Map<PluggyCredential, { key: string; expiresAt: number }>();

export function resetPluggyKeyCache() {
  cached.clear();
}

async function apiKey(credential: PluggyCredential = "principal", force = false) {
  const hit = cached.get(credential);
  if (!force && hit && hit.expiresAt > Date.now()) return hit.key;
  if (!credentialConfigured(credential)) {
    throw new PluggyError(`Credenciais ${credentialOwner(credential)} não configuradas no servidor.`, undefined, "auth", credential);
  }
  const names = credentialEnvNames(credential);
  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: process.env[names.id], clientSecret: process.env[names.secret] }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new PluggyError(`Credenciais ${credentialOwner(credential)} recusadas pela Pluggy.`, res.status, "auth", credential);
  const { apiKey: key } = (await res.json()) as { apiKey?: string };
  if (!key) throw new PluggyError("Resposta de autenticação inválida.", undefined, "invalid");
  // A chave vale 2 horas; renovamos antes.
  cached.set(credential, { key, expiresAt: Date.now() + 100 * 60_000 });
  return key;
}

async function get<T>(path: string, credential: PluggyCredential): Promise<T> {
  for (const force of [false, true]) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "X-API-KEY": await apiKey(credential, force) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if ((res.status === 401 || res.status === 403) && !force) continue;
    if (res.status === 404) throw new PluggyError("Não encontrado na Pluggy.", 404, "not_found", credential);
    if (!res.ok) throw new PluggyError(`Pluggy respondeu ${res.status}.`, res.status, "http", credential);
    return (await res.json()) as T;
  }
  throw new PluggyError("Acesso negado pela Pluggy.", 403, "forbidden", credential);
}

function assertUuid(id: string) {
  if (!UUID.test(id)) throw new PluggyError("Identificador inválido.", undefined, "invalid");
  return id;
}

export type PluggyItem = {
  id: string;
  status: string;
  consentExpiresAt?: string | null;
  connector?: { name?: string } | null;
};

export async function getItem(itemId: string, credential: PluggyCredential = "principal") {
  return get<PluggyItem>(`/items/${assertUuid(itemId)}`, credential);
}

export async function listAccounts(itemId: string, credential: PluggyCredential = "principal") {
  const data = await get<{ results: PluggyAccount[] }>(`/accounts?itemId=${assertUuid(itemId)}`, credential);
  return data.results ?? [];
}

/** Todas as transações da conta desde `dateFrom`, seguindo o cursor da v2. */
export async function listTransactions(accountId: string, dateFrom: string, credential: PluggyCredential = "principal") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) throw new PluggyError("Data inválida.");
  const all: PluggyTransaction[] = [];
  let path = `/v2/transactions?accountId=${assertUuid(accountId)}&dateFrom=${dateFrom}`;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await get<{ results: PluggyTransaction[]; next?: string | null }>(path, credential);
    all.push(...(data.results ?? []));
    if (!data.next) return all;
    // `next` é uma query string pronta; só aceitamos se for para o mesmo endpoint.
    if (!data.next.startsWith("?")) throw new PluggyError("Paginação inesperada.");
    path = `/v2/transactions${data.next}`;
  }
  throw new PluggyError("Muitas páginas de transações; reduza o período.");
}
