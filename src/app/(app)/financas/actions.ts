"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { parseBRL } from "@/lib/financas/money";
import { categorize, cleanDescription, matchCategory, type CategorizeCtx } from "@/lib/financas/rules";
import { decodeStatement, parseOfx } from "@/lib/financas/ofx";
import { parseCsv } from "@/lib/financas/csv";
import { buildImportRows, suggestInvert } from "@/lib/financas/import";
import { validateManualTransaction } from "@/lib/financas/transaction-input";
import { baixaLabels, countBaixas, monthsAround } from "@/lib/financas/baixa";
import { runBaixaAutomatica } from "@/lib/financas/baixa-data";
import { fetchAllPages } from "@/lib/financas/paginate";
import { loadCategorizeCtx, runLinkTransfers } from "@/lib/financas/transfers-data";
import type { Category } from "@/lib/financas/types";

export type FormState = { error?: string; ok?: boolean } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_KINDS = ["corrente", "poupanca", "cartao", "dinheiro", "investimento"];
const CATEGORY_KINDS = ["despesa", "receita", "transferencia"];
const MAX_AMOUNT = 10_000_000;
const MAX_FILE_BYTES = 900 * 1024;

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optUuid = (v: string) => (UUID.test(v) ? v : null);

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/inicio");
}

/* ---------- Lançamentos ---------- */

function readTransaction(form: FormData) {
  return validateManualTransaction({
    accountId: str(form, "account_id"),
    description: str(form, "description"),
    value: parseBRL(str(form, "amount")),
    date: str(form, "date"),
    direction: str(form, "direction"), // saida | entrada
    categoryId: str(form, "category_id"),
    memberId: str(form, "member_id"),
    notes: str(form, "notes"),
  });
}

export async function saveTransaction(_: FormState, form: FormData): Promise<FormState> {
  const { household } = await getAppContext();
  const parsed = readTransaction(form);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const id = optUuid(str(form, "id"));
  // Categoria escolhida no formulário é do usuário: vira histórico para aprender ("parecidos").
  const data = { ...parsed.data, category_source: parsed.data.category_id ? "manual" : null };
  const { error } = id
    ? await supabase.from("fin_transactions").update(data).eq("id", id).eq("household_id", household.id)
    : await supabase.from("fin_transactions").insert({ ...data, household_id: household.id, source: "manual" });
  if (error) return { error: "Não foi possível salvar. Confira conta e categoria." };

  // "Usar para os próximos parecidos": vira regra e já categoriza os parecidos que estão sem categoria.
  let learned = 0;
  const key = cleanDescription(data.description);
  if (form.get("learn") === "on" && data.category_id && key) {
    learned = (await learnRule(supabase, household.id, key, data.category_id)) ?? 0;
  }

  refresh();
  redirect(`/financas/lancamentos?mes=${data.date.slice(0, 7)}${learned > 0 ? `&aprendeu=${learned}` : ""}`);
}

type Db = Awaited<ReturnType<typeof createClient>>;

/** Cria a regra (ou troca a categoria da regra com o mesmo texto) e aplica aos sem categoria. Devolve quantos mudaram. */
async function learnRule(supabase: Db, householdId: string, pattern: string, categoryId: string) {
  const { data: existing } = await supabase
    .from("fin_rules")
    .select("id")
    .eq("household_id", householdId)
    .eq("pattern", pattern)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("fin_rules").update({ category_id: categoryId }).eq("id", existing.id).eq("household_id", householdId)
    : await supabase.from("fin_rules").insert({ household_id: householdId, pattern, category_id: categoryId });
  if (error) return null;
  const rule = [{ pattern, category_id: categoryId }];
  const r = await categorizeUncategorized(supabase, householdId, (description) => {
    const id = matchCategory(description, rule);
    return id ? { category_id: id, category_source: "regra" } : null;
  });
  return r.updated;
}

/**
 * Categoriza os lançamentos que estão sem categoria. Lê todos primeiro (paginado: o PostgREST corta em 1000)
 * e só depois atualiza, em lotes, para a paginação não pular linhas que saem do filtro "sem categoria".
 * `updated` conta as linhas que o banco de fato mudou; `partial` = teto ou falha de leitura/gravação.
 */
async function categorizeUncategorized(
  supabase: Db,
  householdId: string,
  pick: (description: string) => { category_id: string; category_source: string } | null,
) {
  const { rows: txs, incomplete } = await fetchAllPages<{ id: string; description: string }>((from, to) =>
    supabase
      .from("fin_transactions")
      .select("id, description")
      .eq("household_id", householdId)
      .is("category_id", null)
      .order("id")
      .range(from, to),
  );
  const groups = new Map<string, { category_id: string; category_source: string; ids: string[] }>();
  for (const t of txs) {
    const c = pick(t.description);
    if (!c) continue;
    const k = `${c.category_id}|${c.category_source}`;
    const g = groups.get(k) ?? { ...c, ids: [] };
    g.ids.push(t.id);
    groups.set(k, g);
  }
  let updated = 0;
  let failed = false;
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 200) {
      const chunk = g.ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from("fin_transactions")
        .update({ category_id: g.category_id, category_source: g.category_source })
        .in("id", chunk)
        .eq("household_id", householdId)
        // Não sobrescreve categoria que alguém pôs no meio do caminho.
        .is("category_id", null)
        .select("id");
      if (error) failed = true;
      else updated += data?.length ?? 0;
    }
  }
  return { updated, partial: incomplete || failed };
}

export async function deleteTransaction(form: FormData) {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (id) {
    const supabase = await createClient();
    await supabase.from("fin_transactions").delete().eq("id", id).eq("household_id", household.id);
  }
  refresh();
  redirect("/financas/lancamentos");
}

/* ---------- Contas ---------- */

export async function saveAccount(_: FormState, form: FormData): Promise<FormState> {
  const { household } = await getAppContext();
  const name = str(form, "name");
  const kind = str(form, "kind");
  if (!name || name.length > 60) return { error: "Dê um nome à conta (até 60 letras)." };
  if (!ACCOUNT_KINDS.includes(kind)) return { error: "Tipo de conta inválido." };

  const opening = str(form, "opening_balance") ? parseBRL(str(form, "opening_balance")) : 0;
  if (opening === null || Math.abs(opening) > MAX_AMOUNT) return { error: "Saldo inicial inválido." };
  const limit = str(form, "credit_limit") ? parseBRL(str(form, "credit_limit")) : null;
  if (limit !== null && (limit < 0 || limit > MAX_AMOUNT)) return { error: "Limite inválido." };
  const day = (key: string) => {
    const n = Number(str(form, key));
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
  };

  const isCard = kind === "cartao";
  const data = {
    name,
    kind,
    institution: str(form, "institution").slice(0, 60) || null,
    owner_member_id: optUuid(str(form, "owner_member_id")),
    opening_balance: isCard ? 0 : opening,
    credit_limit: isCard ? limit : null,
    closing_day: isCard ? day("closing_day") : null,
    due_day: isCard ? day("due_day") : null,
    archived: form.get("archived") === "on",
  };

  const supabase = await createClient();
  const id = optUuid(str(form, "id"));
  // Cartão não tem campo de saldo inicial no formulário: ao editar, preserva o valor
  // (pode ter sido ajustado para bater com o saldo do banco).
  const { opening_balance, ...rest } = data;
  const updateData = isCard ? rest : data;
  const { error } = id
    ? await supabase.from("fin_accounts").update(updateData).eq("id", id).eq("household_id", household.id)
    : await supabase.from("fin_accounts").insert({ ...rest, opening_balance, household_id: household.id });
  if (error) return { error: "Não foi possível salvar a conta." };

  refresh();
  redirect("/financas/contas");
}

export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (!id) return { error: "Conta inválida." };
  const supabase = await createClient();
  const { count } = await supabase
    .from("fin_transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id)
    .eq("household_id", household.id);
  if ((count ?? 0) > 0) {
    return { error: `Esta conta tem ${count} lançamentos. Arquive em vez de excluir, para não perder o histórico.` };
  }
  await supabase.from("fin_accounts").delete().eq("id", id).eq("household_id", household.id);
  refresh();
  redirect("/financas/contas");
}

/* ---------- Categorias e regras ---------- */

async function createCategory(rawName: string, rawKind: string): Promise<{ error: string } | { category: Category }> {
  const { household } = await getAppContext();
  const name = rawName.trim();
  const kind = rawKind.trim();
  if (!name || name.length > 40) return { error: "Nome da categoria inválido." };
  if (!CATEGORY_KINDS.includes(kind)) return { error: "Tipo inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fin_categories")
    .insert({ household_id: household.id, name, kind })
    .select("id, name, kind, color")
    .single();
  if (error || !data) return { error: error?.code === "23505" ? "Já existe uma categoria com esse nome." : "Não foi possível salvar." };
  return { category: data as Category };
}

export async function addCategory(_: FormState, form: FormData): Promise<FormState> {
  const r = await createCategory(str(form, "name"), str(form, "kind"));
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true };
}

/**
 * "+ Nova" no formulário de lançamento: mesma validação de addCategory, devolve a categoria criada.
 * Não revalida a rota: o formulário aberto não perde o que já foi digitado (a lista de categorias
 * das outras telas é lida de novo a cada navegação).
 */
export async function addCategoryInline(name: string, kind: string): Promise<{ error: string } | { category: Category }> {
  if (typeof name !== "string" || typeof kind !== "string") return { error: "Nome da categoria inválido." };
  return createCategory(name, kind);
}

export async function deleteCategory(form: FormData) {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("fin_categories").delete().eq("id", id).eq("household_id", household.id);
  refresh();
}

export async function addRule(_: FormState, form: FormData): Promise<FormState & { updated?: number }> {
  const { household } = await getAppContext();
  const pattern = str(form, "pattern").toLowerCase();
  const categoryId = optUuid(str(form, "category_id"));
  if (pattern.length < 2 || pattern.length > 60) return { error: "O texto da regra precisa ter de 2 a 60 letras." };
  if (!categoryId) return { error: "Escolha a categoria." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("fin_rules")
    .insert({ household_id: household.id, pattern, category_id: categoryId });
  if (error) return { error: error.code === "23505" ? "Já existe uma regra com esse texto." : "Não foi possível salvar." };
  // Regra nova já vale para os lançamentos que estão sem categoria.
  const applied = await applyRules();
  return { ok: true, updated: applied.updated ?? 0 };
}

export async function deleteRule(form: FormData) {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("fin_rules").delete().eq("id", id).eq("household_id", household.id);
  refresh();
}

/**
 * Aplica regras e histórico da família (categorize) aos lançamentos que ainda estão sem categoria e grava
 * category_source ('regra' | 'historico'). A categoria da Pluggy não entra aqui: só vale na chegada.
 * `updated` conta as linhas que o banco de fato mudou; `partial` = teto ou falha: toque de novo.
 */
export async function applyRules(): Promise<FormState & { updated?: number; partial?: boolean }> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const ctx: CategorizeCtx = { ...(await loadCategorizeCtx(supabase, household.id)), categoryIdByName: new Map() };
  const { updated, partial } = await categorizeUncategorized(supabase, household.id, (description) => {
    const c = categorize({ description }, ctx);
    return c.category_id && c.category_source ? { category_id: c.category_id, category_source: c.category_source } : null;
  });
  refresh();
  return { ok: true, updated, ...(partial ? { partial: true } : {}) };
}

/* ---------- Importação ---------- */

export type PreviewRow = {
  date: string;
  description: string;
  amount: number;
  category: string | null;
  duplicate: boolean;
};

export type ImportState =
  | null
  | { error: string }
  | {
      step: "preview";
      accountId: string;
      fileName: string;
      invert: boolean;
      rows: PreviewRow[];
      errors: string[];
    }
  | { step: "done"; inserted: number; skipped: number; baixas: { bill: string; month: string }[] };

async function readStatement(form: FormData) {
  const { household } = await getAppContext();
  const accountId = optUuid(str(form, "account_id"));
  const file = form.get("file");
  if (!accountId) return { error: "Escolha a conta." } as const;
  if (!(file instanceof File) || file.size === 0) return { error: "Escolha o arquivo OFX ou CSV." } as const;
  if (file.size > MAX_FILE_BYTES) return { error: "Arquivo muito grande (máximo 900 KB). Exporte um período menor." } as const;

  const supabase = await createClient();
  const [{ data: account }, ctx, { data: categories }] = await Promise.all([
    supabase.from("fin_accounts").select("id, kind").eq("id", accountId).eq("household_id", household.id).maybeSingle(),
    loadCategorizeCtx(supabase, household.id),
    supabase.from("fin_categories").select("id, name").eq("household_id", household.id),
  ]);
  if (!account) return { error: "Conta não encontrada." } as const;

  const text = decodeStatement(new Uint8Array(await file.arrayBuffer()));
  const isOfx = /<OFX>/i.test(text) || /\.ofx$/i.test(file.name);
  const parsed = isOfx ? parseOfx(text) : parseCsv(text);
  if (parsed.transactions.length === 0) {
    return { error: parsed.errors[0] ?? "Nenhum lançamento encontrado no arquivo." } as const;
  }
  if (parsed.transactions.length > 2000) return { error: "Arquivo com mais de 2.000 lançamentos. Exporte um período menor." } as const;

  return {
    supabase,
    household,
    account,
    file,
    parsed,
    source: isOfx ? "ofx" : "csv",
    ctx,
    categoryName: new Map((categories ?? []).map((c) => [c.id, c.name])),
  } as const;
}

async function existingIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  ids: string[],
) {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from("fin_transactions")
      .select("external_id")
      .eq("account_id", accountId)
      .in("external_id", ids.slice(i, i + 300));
    (data ?? []).forEach((r) => r.external_id && found.add(r.external_id));
  }
  return found;
}

export async function previewImport(_: ImportState, form: FormData): Promise<ImportState> {
  const r = await readStatement(form);
  if ("error" in r) return { error: r.error as string };
  // Na primeira leitura o app sugere; depois vale a escolha do usuário na caixa "Inverter sinais".
  const invert = form.has("invert_set")
    ? form.get("invert") === "on"
    : suggestInvert(r.parsed.transactions, r.account.kind);
  const rows = buildImportRows(r.parsed.transactions, { invert, rules: r.ctx.rules, history: r.ctx.history });
  const existing = await existingIds(r.supabase, r.account.id, rows.map((x) => x.external_id));
  return {
    step: "preview",
    accountId: r.account.id,
    fileName: r.file.name,
    invert,
    errors: r.parsed.errors.slice(0, 10),
    rows: rows.map((x) => ({
      date: x.date,
      description: x.description,
      amount: x.amount,
      category: x.category_id ? (r.categoryName.get(x.category_id) ?? null) : null,
      duplicate: existing.has(x.external_id),
    })),
  };
}

/** Confirma relendo o arquivo no servidor: nada do que o navegador mostrou é confiado. */
export async function confirmImport(_: ImportState, form: FormData): Promise<ImportState> {
  const r = await readStatement(form);
  if ("error" in r) return { error: r.error as string };
  const invert = form.get("invert") === "on";
  const rows = buildImportRows(r.parsed.transactions, { invert, rules: r.ctx.rules, history: r.ctx.history }).filter(
    (x) => Math.abs(x.amount) <= MAX_AMOUNT,
  );

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await r.supabase
      .from("fin_transactions")
      .upsert(
        rows.slice(i, i + 500).map((x) => ({
          ...x,
          household_id: r.household.id,
          account_id: r.account.id,
          source: r.source,
        })),
        { onConflict: "account_id,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) return { error: "Falha ao gravar os lançamentos. Nada foi duplicado; tente de novo." };
    inserted += data?.length ?? 0;
  }
  // Saídas do arquivo cruzam com as contas fixas (baixa automática, com a sessão do usuário).
  const outflowDates = rows.filter((x) => x.amount < 0).map((x) => x.date);
  const { applied, appliedOneOff } =
    inserted > 0 && outflowDates.length ? await runBaixaAutomatica(monthsAround(outflowDates)) : { applied: [], appliedOneOff: [] };
  let baixas: { bill: string; month: string }[] = [];
  if (countBaixas({ applied, appliedOneOff })) {
    const [{ data: bills }, { data: oneOffs }] = await Promise.all([
      applied.length
        ? r.supabase.from("fin_bills").select("id, name").eq("household_id", r.household.id).in("id", [...new Set(applied.map((m) => m.bill_id))])
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      appliedOneOff.length
        ? r.supabase
            .from("fin_one_off_bills")
            .select("id, name, due_date")
            .eq("household_id", r.household.id)
            .in("id", [...new Set(appliedOneOff.map((m) => m.one_off_bill_id))])
        : Promise.resolve({ data: [] as { id: string; name: string; due_date: string }[] }),
    ]);
    baixas = baixaLabels(
      applied,
      appliedOneOff,
      new Map((bills ?? []).map((b) => [b.id, b.name])),
      new Map((oneOffs ?? []).map((o) => [o.id, { name: o.name, due_date: o.due_date }])),
    );
  }
  // Junta transferências entre contas e pagamentos de fatura. Falha aqui não desfaz a importação.
  if (inserted > 0) {
    try {
      await runLinkTransfers(r.supabase, r.household.id);
    } catch {
      console.error("[importar] falha ao procurar pares de transferência");
    }
  }
  refresh();
  return { step: "done", inserted, skipped: rows.length - inserted, baixas };
}
