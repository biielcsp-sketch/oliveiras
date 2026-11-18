import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO } from "@/lib/pluggy/normalize";
import { fetchAllPages } from "./paginate";
import { buildHistory, categoryIdsByName, type CategorizeCtx } from "./rules";
import { todaySP } from "./today";
import { findTransferPairs, TRANSFER_CATEGORY_NAME, type PairTx, type TransferKind } from "./transfers";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Regras, categorias e histórico (lançamentos categorizados dos últimos 12 meses, da mais recente para a
 * mais antiga, paginado) para categorizar na importação, na sincronização e ao aplicar regras.
 */
export async function loadCategorizeCtx(supabase: Db, householdId: string): Promise<CategorizeCtx> {
  const since = addDaysISO(todaySP(), -365);
  const [{ data: rules }, { data: categories }, { rows: history }] = await Promise.all([
    supabase.from("fin_rules").select("pattern, category_id").eq("household_id", householdId),
    supabase.from("fin_categories").select("id, name").eq("household_id", householdId),
    fetchAllPages<{ description: string; category_id: string | null; category_source: string | null }>((from, to) =>
      supabase
        .from("fin_transactions")
        .select("description, category_id, category_source")
        .eq("household_id", householdId)
        .not("category_id", "is", null)
        .gte("date", since)
        .order("date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
  ]);
  return {
    rules: rules ?? [],
    history: buildHistory(history),
    categoryIdByName: categoryIdsByName((categories ?? []).filter((c) => typeof c.name === "string")),
  };
}

const TX_PAIR_COLS = "id, account_id, date, description, amount, category_id, category_source, transfer_group, transfer_checked";

/** Categoria de transferência pelo nome (kind 'transferencia'); undefined se a família não a tiver. */
export function transferCategoryId(categories: { id: string; name: string; kind: string }[], kind: TransferKind) {
  return categories.find((c) => c.kind === "transferencia" && c.name === TRANSFER_CATEGORY_NAME[kind])?.id;
}

/**
 * Grava um par: mesmo transfer_group nas duas pernas e categoria de transferência (category_source 'par').
 * Categoria de transferência escolhida à mão (ex.: 'Aplicação e resgate') é mantida.
 * Guarda `.is('transfer_group', null)`: perna que já entrou em outro par não é tocada.
 */
export async function writePair(
  supabase: Db,
  householdId: string,
  legs: { id: string; category_id: string | null; category_source?: string | null }[],
  categories: { id: string; name: string; kind: string }[],
  kind: TransferKind,
) {
  const group = crypto.randomUUID();
  const catId = transferCategoryId(categories, kind);
  const transferIds = new Set(categories.filter((c) => c.kind === "transferencia").map((c) => c.id));
  let ok = 0;
  for (const leg of legs) {
    const keepManual = leg.category_id && transferIds.has(leg.category_id) && leg.category_source === "manual";
    const patch: Record<string, unknown> = { transfer_group: group };
    if (catId && !keepManual) Object.assign(patch, { category_id: catId, category_source: "par" });
    const { data, error } = await supabase
      .from("fin_transactions")
      .update(patch)
      .eq("id", leg.id)
      .eq("household_id", householdId)
      .is("transfer_group", null)
      .select("id");
    if (!error && data?.length) ok++;
  }
  return ok === legs.length;
}

async function loadPairInput(supabase: Db, householdId: string) {
  const since = addDaysISO(todaySP(), -120);
  const [{ rows }, { data: accounts }, { data: members }, { data: categories }] = await Promise.all([
    fetchAllPages<PairTx>((from, to) =>
      supabase
        .from("fin_transactions")
        .select(TX_PAIR_COLS)
        .eq("household_id", householdId)
        .is("transfer_group", null)
        .eq("transfer_checked", false)
        .gte("date", since)
        .order("date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
    supabase.from("fin_accounts").select("id, kind").eq("household_id", householdId),
    supabase.from("members").select("name").eq("household_id", householdId),
    supabase.from("fin_categories").select("id, name, kind").eq("household_id", householdId),
  ]);
  const txs = rows.map((t) => ({ ...t, amount: Number(t.amount) }));
  const cats = categories ?? [];
  const found = findTransferPairs(txs, accounts ?? [], (members ?? []).map((m) => m.name), cats);
  return { ...found, categories: cats, byId: new Map(txs.map((t) => [t.id, t])) };
}

/** Procura e grava pares nos últimos 120 dias. Devolve quantos pares gravou e quantos itens ficaram para conferir. */
export async function runLinkTransfers(supabase: Db, householdId: string) {
  const { pairs, review, categories, byId } = await loadPairInput(supabase, householdId);
  let linked = 0;
  for (const p of pairs) {
    if (await writePair(supabase, householdId, [byId.get(p.outId)!, byId.get(p.inId)!], categories, p.kind)) linked++;
  }
  return { linked, review: review.length };
}

/** Itens para conferir (sem gravar nada), para a aba Transferências. */
export async function getTransferReview(supabase: Db, householdId: string) {
  const { review, byId } = await loadPairInput(supabase, householdId);
  return review.map((r) => ({ ...r, out: byId.get(r.outId)!, in: byId.get(r.inId)! }));
}
