import { createHash } from "node:crypto";
import { matchCategory, normalizeText, type Rule } from "@/lib/financas/rules";

export type PluggyTransaction = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  type: "DEBIT" | "CREDIT" | string;
  status?: string;
  providerId?: string | null;
};

export type PluggyAccount = {
  id: string;
  name: string;
  marketingName?: string | null;
  number?: string | null;
  type: string;
  subtype?: string | null;
  balance: number;
};

export type SyncRow = { date: string; description: string; amount: number; external_id: string; category_id: string | null };

/**
 * Sinal do app: saída negativa, entrada positiva. A Pluggy usa sinais diferentes em
 * conta e cartão (no cartão a compra vem positiva), mas `type` é sempre
 * DEBIT = saída e CREDIT = entrada. Por isso o sinal sai do `type`.
 */
export function toAppAmount(tx: Pick<PluggyTransaction, "amount" | "type">) {
  const abs = Math.round(Math.abs(tx.amount) * 100) / 100;
  return tx.type === "CREDIT" ? abs : -abs;
}

/**
 * Chave estável entre sincronizações. O id da Pluggy muda quando o cartão reapresenta
 * a fatura; por isso usamos o providerId (Open Finance) ou, sem ele, data + valor +
 * descrição + ocorrência no dia, como a própria Pluggy recomenda.
 */
export function buildSyncRows(txs: PluggyTransaction[], rules: Rule[]): SyncRow[] {
  const seen = new Map<string, number>();
  return txs
    .filter((t) => Number.isFinite(t.amount) && t.amount !== 0 && /^\d{4}-\d{2}-\d{2}/.test(t.date))
    .map((t) => {
      const date = t.date.slice(0, 10);
      const description = (t.description ?? "").trim().slice(0, 200) || "Sem descrição";
      const amount = toAppAmount(t);
      let external_id: string;
      if (t.providerId) {
        external_id = `pluggy:p:${t.providerId}`.slice(0, 120);
      } else {
        const key = `${date}|${amount.toFixed(2)}|${normalizeText(description)}`;
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        external_id = `pluggy:h:${createHash("sha256").update(`${key}|${n}`).digest("hex").slice(0, 40)}`;
      }
      return { date, description, amount, external_id, category_id: matchCategory(description, rules) };
    });
}

export type ExistingRow = { id: string; external_id: string | null; date: string; amount: number; description: string };

/**
 * O que gravar: novos lançamentos, os que mudaram (pendente → lançado, valor ajustado)
 * e os que sumiram na Pluggy dentro da janela sincronizada (reapresentação da fatura).
 * A categoria nunca é sobrescrita em atualização.
 */
export function planSync(existing: ExistingRow[], incoming: SyncRow[], opts: { allowDeletes: boolean } = { allowDeletes: true }) {
  const byKey = new Map(existing.filter((e) => e.external_id).map((e) => [e.external_id as string, e]));
  const incomingKeys = new Set(incoming.map((r) => r.external_id));
  const inserts: SyncRow[] = [];
  const updates: { id: string; date: string; amount: number; description: string }[] = [];
  for (const r of incoming) {
    const e = byKey.get(r.external_id);
    if (!e) inserts.push(r);
    else if (e.date !== r.date || Math.round(e.amount * 100) !== Math.round(r.amount * 100) || e.description !== r.description) {
      updates.push({ id: e.id, date: r.date, amount: r.amount, description: r.description });
    }
  }
  // Leitura vazia nunca apaga: é o que a Pluggy devolve com autorização vencida ou falha
  // na conexão. Também não apaga quando o item não está saudável (allowDeletes = false).
  const deletes =
    opts.allowDeletes && incoming.length > 0
      ? existing.filter((e) => e.external_id && !incomingKeys.has(e.external_id)).map((e) => e.id)
      : [];
  return { inserts, updates, deletes };
}

export function accountKindFrom(a: Pick<PluggyAccount, "type" | "subtype">) {
  if (a.type === "CREDIT" || a.subtype === "CREDIT_CARD") return "cartao" as const;
  if (a.subtype === "SAVINGS_ACCOUNT") return "poupanca" as const;
  return "corrente" as const;
}

/** Saldo no sinal do app: no cartão a Pluggy informa a dívida como positivo. */
export function bankBalanceToApp(a: Pick<PluggyAccount, "type" | "subtype" | "balance">) {
  const v = Math.round(a.balance * 100) / 100;
  return accountKindFrom(a) === "cartao" ? -v : v;
}

export function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Começo da sincronização: dia seguinte ao último lançamento manual/importado, ou 90 dias atrás. */
export function defaultSyncFrom(lastOtherDate: string | null, today: string) {
  return lastOtherDate ? addDaysISO(lastOtherDate, 1) : addDaysISO(today, -90);
}

/** Janela de cada sincronização: últimos 60 dias, nunca antes do início escolhido. */
export function syncWindowStart(syncFrom: string | null, today: string) {
  const sixty = addDaysISO(today, -60);
  return syncFrom && syncFrom > sixty ? syncFrom : sixty;
}

export function maskNumber(n: string | null | undefined) {
  if (!n) return "";
  const digits = n.replace(/\s/g, "");
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits;
}

/** Remoções só com item atualizado e autorização em dia. */
export function itemHealthy(status: string | null | undefined, consentExpiresAt: string | null | undefined, nowIso: string) {
  if (status !== "UPDATED") return false;
  if (consentExpired(consentExpiresAt, nowIso)) return false;
  return true;
}

/** Compara como data (aceita qualquer formato ISO, com ou sem fuso explícito). */
export function consentExpired(consentExpiresAt: string | null | undefined, nowIso: string) {
  if (!consentExpiresAt) return false;
  const t = Date.parse(consentExpiresAt);
  return Number.isFinite(t) && t <= Date.parse(nowIso);
}
