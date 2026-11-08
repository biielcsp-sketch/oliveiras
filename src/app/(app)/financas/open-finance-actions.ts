"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { todaySP } from "@/lib/financas/today";
import { getItem, listAccounts, pluggyAllowedFor, pluggyConfigured, PluggyError } from "@/lib/pluggy/client";
import { accountKindFrom, defaultSyncFrom } from "@/lib/pluggy/normalize";
import { syncHousehold, type SyncResult } from "@/lib/pluggy/sync";

export type OfState = { error?: string; ok?: boolean; message?: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/inicio");
}

async function guard() {
  const ctx = await getAppContext();
  if (!pluggyConfigured()) return { error: "Open Finance ainda não configurado no servidor." } as const;
  if (!pluggyAllowedFor(ctx.household.id)) return { error: "Esta família não está autorizada a usar o Open Finance." } as const;
  return { ctx } as const;
}

export async function addItem(_: OfState, form: FormData): Promise<OfState> {
  const g = await guard();
  if ("error" in g) return { error: g.error };
  const itemId = str(form, "item_id").toLowerCase();
  if (!UUID.test(itemId)) return { error: "Cole o id do item como aparece em Connected Items (formato UUID)." };

  let label = str(form, "label").slice(0, 60);
  try {
    const item = await getItem(itemId);
    label ||= item.connector?.name?.slice(0, 60) ?? "Banco";
  } catch (e) {
    if (e instanceof PluggyError && e.status === 404) {
      return { error: "Item não encontrado na Pluggy. Confira se copiou o id da aplicação certa." };
    }
    return { error: "Não foi possível falar com a Pluggy agora. Tente de novo." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("fin_pluggy_items")
    .insert({ household_id: g.ctx.household.id, item_id: itemId, label });
  if (error) return { error: error.code === "23505" ? "Este item já está conectado." : "Não foi possível salvar." };
  refresh();
  return { ok: true };
}

export async function removeItem(form: FormData) {
  const { household } = await getAppContext();
  const id = str(form, "id");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  // As contas continuam, com os lançamentos; só deixam de sincronizar.
  await supabase
    .from("fin_accounts")
    .update({ external_id: null })
    .eq("household_id", household.id)
    .eq("pluggy_item_ref", id);
  await supabase.from("fin_pluggy_items").delete().eq("id", id).eq("household_id", household.id);
  refresh();
}

/** Vincula uma conta da Pluggy a uma conta nova ou existente do app. */
export async function linkAccount(_: OfState, form: FormData): Promise<OfState> {
  const g = await guard();
  if ("error" in g) return { error: g.error };
  const { household } = g.ctx;
  const itemRef = str(form, "item_ref");
  const remoteId = str(form, "remote_id");
  const target = str(form, "target");
  const syncFromInput = str(form, "sync_from");
  if (!UUID.test(itemRef) || !UUID.test(remoteId)) return { error: "Dados inválidos." };
  if (syncFromInput && !ISO_DATE.test(syncFromInput)) return { error: "Data inválida." };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("fin_pluggy_items")
    .select("id, item_id, label")
    .eq("id", itemRef)
    .eq("household_id", household.id)
    .maybeSingle();
  if (!item) return { error: "Conexão não encontrada." };

  let remote;
  try {
    remote = (await listAccounts(item.item_id)).find((a) => a.id === remoteId);
  } catch {
    return { error: "Não foi possível falar com a Pluggy agora." };
  }
  if (!remote) return { error: "Conta não encontrada nesta conexão." };

  if (target === "new") {
    const { error } = await supabase.from("fin_accounts").insert({
      household_id: household.id,
      name: (remote.marketingName || remote.name || "Conta").slice(0, 60),
      kind: accountKindFrom(remote),
      institution: item.label,
      external_id: remote.id,
      pluggy_item_ref: item.id,
      sync_from: syncFromInput || defaultSyncFrom(null, todaySP()),
    });
    if (error) return { error: error.code === "23505" ? "Esta conta já está vinculada." : "Não foi possível criar a conta." };
  } else if (UUID.test(target)) {
    let syncFrom = syncFromInput;
    if (!syncFrom) {
      // Começa depois do último lançamento que já existe na conta (OFX/CSV/manual), para não duplicar.
      const { data: last } = await supabase
        .from("fin_transactions")
        .select("date")
        .eq("household_id", household.id)
        .eq("account_id", target)
        .neq("source", "openfinance")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      syncFrom = defaultSyncFrom(last?.date ?? null, todaySP());
    }
    const { data, error } = await supabase
      .from("fin_accounts")
      .update({ external_id: remote.id, pluggy_item_ref: item.id, sync_from: syncFrom })
      .eq("id", target)
      .eq("household_id", household.id)
      .select("id");
    if (error) return { error: error.code === "23505" ? "Esta conta da Pluggy já está vinculada a outra." : "Não foi possível vincular." };
    if (!data?.length) return { error: "Conta do app não encontrada." };
  } else {
    return { error: "Escolha criar uma conta nova ou vincular a uma existente." };
  }
  refresh();
  return { ok: true };
}

export async function unlinkAccount(form: FormData) {
  const { household } = await getAppContext();
  const id = str(form, "id");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  await supabase
    .from("fin_accounts")
    .update({ external_id: null, pluggy_item_ref: null })
    .eq("id", id)
    .eq("household_id", household.id);
  refresh();
}

function describe(r: SyncResult): string {
  if (r.status === "skipped") {
    return {
      "nao-configurado": "Open Finance não configurado.",
      "nao-autorizado": "Família não autorizada.",
      "sem-conexoes": "Nenhuma conexão cadastrada.",
      recente: "Já sincronizado há pouco.",
    }[r.reason];
  }
  const parts = [`${r.inserted} novos`, `${r.updated} atualizados`, `${r.removed} removidos`];
  return `Sincronizado: ${parts.join(", ")}.${r.errors.length ? ` Atenção: ${r.errors[0]}` : ""}`;
}

export async function syncNow(): Promise<OfState> {
  const r = await syncHousehold({ force: true });
  refresh();
  return r.status === "done" && r.errors.length ? { error: describe(r) } : { ok: true, message: describe(r) };
}

/** Chamado ao abrir Finanças: só sincroniza se a última vez foi há mais de 6 horas. */
export async function autoSync(): Promise<{ changed: boolean }> {
  try {
    const r = await syncHousehold({ force: false });
    const changed = r.status === "done" && r.inserted + r.updated + r.removed > 0;
    if (changed) refresh();
    return { changed };
  } catch {
    return { changed: false };
  }
}

/** Ajusta o saldo inicial para o saldo do app bater com o saldo informado pelo banco. */
export async function matchBankBalance(form: FormData) {
  const { household } = await getAppContext();
  const id = str(form, "id");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  const [{ data: acc }, { data: txs }] = await Promise.all([
    supabase.from("fin_accounts").select("bank_balance").eq("id", id).eq("household_id", household.id).maybeSingle(),
    supabase.from("fin_transactions").select("amount").eq("account_id", id).eq("household_id", household.id).limit(20000),
  ]);
  if (acc?.bank_balance === null || acc?.bank_balance === undefined) return;
  const sumCents = (txs ?? []).reduce((s, t) => s + Math.round(Number(t.amount) * 100), 0);
  const opening = (Math.round(Number(acc.bank_balance) * 100) - sumCents) / 100;
  await supabase.from("fin_accounts").update({ opening_balance: opening }).eq("id", id).eq("household_id", household.id);
  refresh();
}
