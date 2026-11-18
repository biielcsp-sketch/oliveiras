"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { runLinkTransfers, writePair } from "@/lib/financas/transfers-data";

export type TransferActionState = { ok?: boolean; error?: string; linked?: number; review?: number } | null;

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/inicio");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** "Procurar pares": junta transferências entre contas da família e pagamentos de fatura dos últimos 120 dias. */
export async function linkTransfers(): Promise<TransferActionState> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  try {
    const r = await runLinkTransfers(supabase, household.id);
    refresh();
    return { ok: true, ...r };
  } catch {
    return { error: "Não foi possível procurar pares agora." };
  }
}

/** "Juntar" (Conferir): o usuário confirma que as duas pernas são a mesma transferência. */
export async function joinPair(outId: string, inId: string): Promise<TransferActionState> {
  const { household } = await getAppContext();
  if (!isUuid(outId) || !isUuid(inId) || outId === inId) return { error: "Lançamentos inválidos." };
  const supabase = await createClient();
  const [{ data: legs }, { data: accounts }, { data: categories }] = await Promise.all([
    supabase
      .from("fin_transactions")
      .select("id, account_id, amount, category_id, category_source, transfer_group")
      .eq("household_id", household.id)
      .in("id", [outId, inId]),
    supabase.from("fin_accounts").select("id, kind").eq("household_id", household.id),
    supabase.from("fin_categories").select("id, name, kind").eq("household_id", household.id),
  ]);
  const out = legs?.find((l) => l.id === outId);
  const inn = legs?.find((l) => l.id === inId);
  if (!out || !inn || out.transfer_group || inn.transfer_group) return { error: "Lançamentos não encontrados ou já juntados." };
  const outAmount = Number(out.amount);
  const inAmount = Number(inn.amount);
  if (outAmount >= 0 || inAmount <= 0 || Math.round(-outAmount * 100) !== Math.round(inAmount * 100) || out.account_id === inn.account_id) {
    return { error: "Os valores ou as contas não formam uma transferência." };
  }
  const kindOf = new Map((accounts ?? []).map((a) => [a.id, a.kind]));
  const kind = kindOf.get(inn.account_id) === "cartao" && kindOf.get(out.account_id) !== "cartao" ? "cartao" : "transferencia";
  // Confirmação do usuário: categoria escolhida à mão que não é de transferência passa a ser a de transferência.
  const transferIds = new Set((categories ?? []).filter((c) => c.kind === "transferencia").map((c) => c.id));
  const asAuto = (l: typeof out) =>
    l.category_id && transferIds.has(l.category_id) ? l : { ...l, category_source: "par" };
  const ok = await writePair(supabase, household.id, [asAuto(out), asAuto(inn)], categories ?? [], kind);
  refresh();
  return ok ? { ok: true } : { error: "Não foi possível juntar." };
}

/** "Não é transferência": as duas pernas não voltam a ser sugeridas. */
export async function dismissPair(outId: string, inId: string): Promise<TransferActionState> {
  const { household } = await getAppContext();
  if (!isUuid(outId) || !isUuid(inId)) return { error: "Lançamentos inválidos." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("fin_transactions")
    .update({ transfer_checked: true })
    .in("id", [outId, inId])
    .eq("household_id", household.id);
  refresh();
  return error ? { error: "Não foi possível salvar." } : { ok: true };
}

/**
 * "Separar": desfaz o par e marca as pernas como conferidas (não voltam a ser pareadas sozinhas).
 * A categoria que o próprio pareamento pôs (category_source 'par') sai, para o lançamento voltar aos totais.
 */
export async function unlinkPair(group: string): Promise<TransferActionState> {
  const { household } = await getAppContext();
  if (!isUuid(group)) return { error: "Par inválido." };
  const supabase = await createClient();
  const { error: e1 } = await supabase
    .from("fin_transactions")
    .update({ category_id: null, category_source: null })
    .eq("household_id", household.id)
    .eq("transfer_group", group)
    .eq("category_source", "par");
  const { error: e2 } = await supabase
    .from("fin_transactions")
    .update({ transfer_group: null, transfer_checked: true })
    .eq("household_id", household.id)
    .eq("transfer_group", group);
  refresh();
  return e1 || e2 ? { error: "Não foi possível separar." } : { ok: true };
}
