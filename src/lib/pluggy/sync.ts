import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { todaySP } from "@/lib/financas/today";
import { getItem, listAccounts, listTransactions, pluggyAllowedFor, pluggyConfigured, PluggyError } from "./client";
import { bankBalanceToApp, buildSyncRows, planSync, syncWindowStart } from "./normalize";

export type SyncResult =
  | { status: "skipped"; reason: "nao-configurado" | "nao-autorizado" | "sem-conexoes" | "recente" }
  | { status: "done"; inserted: number; updated: number; removed: number; errors: string[] };

const STALE_MS = 6 * 60 * 60 * 1000;

/** Sincroniza as contas vinculadas da família com a sessão do usuário (RLS vale aqui). */
export async function syncHousehold({ force }: { force: boolean }): Promise<SyncResult> {
  const { household } = await getAppContext();
  if (!pluggyConfigured()) return { status: "skipped", reason: "nao-configurado" };
  if (!pluggyAllowedFor(household.id)) return { status: "skipped", reason: "nao-autorizado" };

  const supabase = await createClient();
  const { data: items } = await supabase
    .from("fin_pluggy_items")
    .select("id, item_id, last_sync_at")
    .eq("household_id", household.id);
  if (!items?.length) return { status: "skipped", reason: "sem-conexoes" };
  if (!force && items.every((i) => i.last_sync_at && Date.now() - Date.parse(i.last_sync_at) < STALE_MS)) {
    return { status: "skipped", reason: "recente" };
  }

  const today = todaySP();
  const { data: rules } = await supabase.from("fin_rules").select("pattern, category_id").eq("household_id", household.id);
  let inserted = 0;
  let updated = 0;
  let removed = 0;
  const errors: string[] = [];

  for (const item of items) {
    let lastError: string | null = null;
    try {
      const info = await getItem(item.item_id);
      await supabase
        .from("fin_pluggy_items")
        .update({ status: info.status?.slice(0, 40) ?? null, consent_expires_at: info.consentExpiresAt ?? null })
        .eq("id", item.id)
        .eq("household_id", household.id);

      const { data: linked } = await supabase
        .from("fin_accounts")
        .select("id, external_id, sync_from")
        .eq("household_id", household.id)
        .eq("pluggy_item_ref", item.id)
        .eq("archived", false)
        .not("external_id", "is", null);
      if (!linked?.length) continue;

      const remote = new Map((await listAccounts(item.item_id)).map((a) => [a.id, a]));
      for (const acc of linked) {
        const r = remote.get(acc.external_id!);
        if (!r) {
          lastError = "Uma conta vinculada não aparece mais na Pluggy.";
          continue;
        }
        await supabase
          .from("fin_accounts")
          .update({ bank_balance: bankBalanceToApp(r), bank_balance_at: new Date().toISOString() })
          .eq("id", acc.id)
          .eq("household_id", household.id);

        const windowStart = syncWindowStart(acc.sync_from, today);
        const rows = buildSyncRows(await listTransactions(r.id, windowStart), rules ?? []);
        const { data: existing } = await supabase
          .from("fin_transactions")
          .select("id, external_id, date, amount, description")
          .eq("household_id", household.id)
          .eq("account_id", acc.id)
          .eq("source", "openfinance")
          .gte("date", windowStart)
          .limit(5000);
        const plan = planSync(
          (existing ?? []).map((e) => ({ ...e, amount: Number(e.amount) })),
          rows,
        );

        for (let i = 0; i < plan.inserts.length; i += 500) {
          const { data, error } = await supabase
            .from("fin_transactions")
            .upsert(
              plan.inserts.slice(i, i + 500).map((x) => ({
                ...x,
                household_id: household.id,
                account_id: acc.id,
                source: "openfinance",
              })),
              { onConflict: "account_id,external_id", ignoreDuplicates: true },
            )
            .select("id");
          if (error) throw new Error("Falha ao gravar lançamentos.");
          inserted += data?.length ?? 0;
        }
        for (const u of plan.updates) {
          const { id, ...fields } = u;
          const { error } = await supabase
            .from("fin_transactions")
            .update(fields)
            .eq("id", id)
            .eq("household_id", household.id);
          if (!error) updated++;
        }
        for (let i = 0; i < plan.deletes.length; i += 200) {
          const ids = plan.deletes.slice(i, i + 200);
          const { error } = await supabase
            .from("fin_transactions")
            .delete()
            .in("id", ids)
            .eq("household_id", household.id)
            .eq("source", "openfinance");
          if (!error) removed += ids.length;
        }
      }
    } catch (e) {
      lastError = e instanceof PluggyError ? e.message : "Falha ao sincronizar esta conexão.";
    }
    if (lastError) errors.push(lastError);
    await supabase
      .from("fin_pluggy_items")
      .update({ last_sync_at: new Date().toISOString(), last_error: lastError })
      .eq("id", item.id)
      .eq("household_id", household.id);
  }
  return { status: "done", inserted, updated, removed, errors };
}
