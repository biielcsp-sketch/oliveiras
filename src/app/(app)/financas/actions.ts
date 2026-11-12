"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { parseBRL } from "@/lib/financas/money";
import { matchCategory } from "@/lib/financas/rules";
import { decodeStatement, parseOfx } from "@/lib/financas/ofx";
import { parseCsv } from "@/lib/financas/csv";
import { buildImportRows, suggestInvert } from "@/lib/financas/import";
import { validateManualTransaction } from "@/lib/financas/transaction-input";
import { baixaLabels, countBaixas, monthsAround } from "@/lib/financas/baixa";
import { runBaixaAutomatica } from "@/lib/financas/baixa-data";

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
  const { error } = id
    ? await supabase.from("fin_transactions").update(parsed.data).eq("id", id).eq("household_id", household.id)
    : await supabase.from("fin_transactions").insert({ ...parsed.data, household_id: household.id, source: "manual" });
  if (error) return { error: "Não foi possível salvar. Confira conta e categoria." };

  refresh();
  redirect(`/financas/lancamentos?mes=${parsed.data.date.slice(0, 7)}`);
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

export async function addCategory(_: FormState, form: FormData): Promise<FormState> {
  const { household } = await getAppContext();
  const name = str(form, "name");
  const kind = str(form, "kind");
  if (!name || name.length > 40) return { error: "Nome da categoria inválido." };
  if (!CATEGORY_KINDS.includes(kind)) return { error: "Tipo inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("fin_categories").insert({ household_id: household.id, name, kind });
  if (error) return { error: error.code === "23505" ? "Já existe uma categoria com esse nome." : "Não foi possível salvar." };
  refresh();
  return { ok: true };
}

export async function deleteCategory(form: FormData) {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("fin_categories").delete().eq("id", id).eq("household_id", household.id);
  refresh();
}

export async function addRule(_: FormState, form: FormData): Promise<FormState> {
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
  refresh();
  return { ok: true };
}

export async function deleteRule(form: FormData) {
  const { household } = await getAppContext();
  const id = optUuid(str(form, "id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("fin_rules").delete().eq("id", id).eq("household_id", household.id);
  refresh();
}

/** Aplica as regras aos lançamentos que ainda estão sem categoria. */
export async function applyRules(): Promise<FormState & { updated?: number }> {
  const { household } = await getAppContext();
  const supabase = await createClient();
  const [{ data: rules }, { data: txs }] = await Promise.all([
    supabase.from("fin_rules").select("pattern, category_id").eq("household_id", household.id),
    supabase
      .from("fin_transactions")
      .select("id, description")
      .eq("household_id", household.id)
      .is("category_id", null)
      .limit(5000),
  ]);
  const byCategory = new Map<string, string[]>();
  for (const t of txs ?? []) {
    const cat = matchCategory(t.description, rules ?? []);
    if (cat) byCategory.set(cat, [...(byCategory.get(cat) ?? []), t.id]);
  }
  let updated = 0;
  for (const [categoryId, ids] of byCategory) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await supabase
        .from("fin_transactions")
        .update({ category_id: categoryId })
        .in("id", chunk)
        .eq("household_id", household.id);
      if (!error) updated += chunk.length;
    }
  }
  refresh();
  return { ok: true, updated };
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
  const [{ data: account }, { data: rules }, { data: categories }] = await Promise.all([
    supabase.from("fin_accounts").select("id, kind").eq("id", accountId).eq("household_id", household.id).maybeSingle(),
    supabase.from("fin_rules").select("pattern, category_id").eq("household_id", household.id),
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
    rules: rules ?? [],
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
  const rows = buildImportRows(r.parsed.transactions, { invert, rules: r.rules });
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
  const rows = buildImportRows(r.parsed.transactions, { invert, rules: r.rules }).filter(
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
  refresh();
  return { step: "done", inserted, skipped: rows.length - inserted, baixas };
}
