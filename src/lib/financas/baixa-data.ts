import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { monthRange, shiftMonth } from "./period";
import { getBills } from "./planning-data";
import {
  oneOffPairKey, pairKey, planBaixasComAvulsas, type BaixaBoleto, type BaixaMatch, type BaixaOneOff, type BaixaPayment, type BaixaTx, type OneOffMatch,
} from "./baixa";

/**
 * Leitura e gravação da baixa automática. Tudo com a sessão do usuário (RLS) e filtrando pelo
 * household do servidor; nunca chave de serviço. Reutilizável por outros módulos (ex.: Casa).
 */

/** Código de barras vindo de um lançamento recém-sincronizado (a coluna não existe em fin_transactions). */
export type TxCode = { account_id: string; external_id: string; barcode: string };

const STATEMENT_SOURCES = ["openfinance", "ofx", "csv"] as const;

type Db = Awaited<ReturnType<typeof createClient>>;

/** Pares conta+lançamento dispensados pela família (vale para os dois do casal, em qualquer aparelho). */
async function ignoredPairs(db: Db, householdId: string, txIds: string[]) {
  const rows = await chunked(txIds, 300, (part) =>
    db.from("fin_baixa_dismissals").select("bill_id, transaction_id").eq("household_id", householdId).in("transaction_id", part),
  );
  return new Set(rows.map((r) => pairKey(r)));
}

/** Pares avulsa+lançamento dispensados (fin_one_off_baixa_dismissals). */
async function ignoredOneOffPairs(db: Db, householdId: string, txIds: string[]) {
  const rows = await chunked(txIds, 300, (part) =>
    db.from("fin_one_off_baixa_dismissals").select("one_off_bill_id, transaction_id").eq("household_id", householdId).in("transaction_id", part),
  );
  return new Set(rows.map((r) => oneOffPairKey(r)));
}

export type DismissReason = "nao_e" | "desfeita";

/** Grava a dispensa do par (idempotente pelo unique household+conta+lançamento). */
export async function dismissPair(billId: string, transactionId: string, reason: DismissReason) {
  const { household } = await getAppContext();
  const db = await createClient();
  const { error } = await db
    .from("fin_baixa_dismissals")
    .upsert(
      { household_id: household.id, bill_id: billId, transaction_id: transactionId, reason },
      { onConflict: "household_id,bill_id,transaction_id", ignoreDuplicates: true },
    );
  return !error;
}

/** Grava a dispensa do par avulsa+lançamento (idempotente pelo unique household+avulsa+lançamento). */
export async function dismissOneOffPair(oneOffId: string, transactionId: string, reason: DismissReason) {
  const { household } = await getAppContext();
  const db = await createClient();
  const { error } = await db
    .from("fin_one_off_baixa_dismissals")
    .upsert(
      { household_id: household.id, one_off_bill_id: oneOffId, transaction_id: transactionId, reason },
      { onConflict: "household_id,one_off_bill_id,transaction_id", ignoreDuplicates: true },
    );
  return !error;
}

/**
 * Onde o lançamento já está ligado: pagamentos de conta fixa e contas avulsas. Base da regra
 * "um lançamento paga uma conta só" (txPayConflict), que o banco não garante entre as duas tabelas.
 */
export async function transactionUses(db: Db, householdId: string, transactionId: string) {
  const [{ data: fixed }, { data: oneOff }] = await Promise.all([
    db.from("fin_bill_payments").select("bill_id, month").eq("household_id", householdId).eq("transaction_id", transactionId),
    db.from("fin_one_off_bills").select("id").eq("household_id", householdId).eq("transaction_id", transactionId),
  ]);
  return { fixed: (fixed ?? []) as { bill_id: string; month: string }[], oneOff: (oneOff ?? []) as { id: string }[] };
}

async function chunked<T>(ids: string[], size: number, run: (part: string[]) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...((await run(ids.slice(i, i + size))).data ?? []));
  return out;
}

const ONE_OFF_COLS = "id, name, amount, due_date, account_id, paid_on, transaction_id";
type OneOffRow = { id: string; name: string; amount: number | string; due_date: string; account_id: string | null; paid_on: string | null; transaction_id: string | null };

/** Monta a entrada do casamento para os meses (e os boletos dos códigos informados). */
export async function loadBaixaInput(months: string[], codes: TxCode[] = []) {
  const { household } = await getAppContext();
  const db: Db = await createClient();
  const sorted = [...new Set(months)].sort();
  if (sorted.length === 0) return null;
  const bills = await getBills();
  // Avulsas cujo vencimento cai nos meses (as em aberto viram candidatas; as pagas marcam lançamentos ligados).
  const { data: monthOneOffs } = await db
    .from("fin_one_off_bills")
    .select(ONE_OFF_COLS)
    .eq("household_id", household.id)
    .gte("due_date", monthRange(sorted[0]).start)
    .lt("due_date", monthRange(sorted[sorted.length - 1]).end);
  if (bills.length === 0 && (monthOneOffs ?? []).length === 0) return null;

  const from = monthRange(shiftMonth(sorted[0], -1)).start;
  const to = monthRange(shiftMonth(sorted[sorted.length - 1], 1)).end;
  const boletoCols = "bill_id, bill_month, amount, due_date, barcode, payee";
  const [{ data: txRows }, { data: monthBoletos }] = await Promise.all([
    db
      .from("fin_transactions")
      .select("id, account_id, date, amount, description, external_id")
      .eq("household_id", household.id)
      .lt("amount", 0)
      // Só o extrato (Open Finance e OFX/CSV): lançamento manual ou de comprovante não entra no cruzamento.
      .in("source", [...STATEMENT_SOURCES])
      .gte("date", from)
      .lt("date", to)
      .order("date")
      .limit(5000),
    db
      .from("fin_documents")
      .select(boletoCols)
      .eq("household_id", household.id)
      .eq("status", "confirmado")
      .eq("kind", "boleto")
      .not("bill_id", "is", null)
      .in("bill_month", sorted),
  ]);

  const codeOf = new Map(codes.map((c) => [`${c.account_id}|${c.external_id}`, c.barcode]));
  const txs: BaixaTx[] = (txRows ?? []).map((t) => ({
    id: t.id,
    account_id: t.account_id,
    date: t.date,
    amount: Number(t.amount),
    description: t.description,
    barcode: t.external_id ? (codeOf.get(`${t.account_id}|${t.external_id}`) ?? null) : null,
  }));
  const txIds = txs.map((t) => t.id);

  // Boletos dos códigos recebidos podem ser de outro mês (pagamento adiantado/atrasado).
  const codeBarcodes = [...new Set(codes.map((c) => c.barcode))];
  const codeBoletos = codeBarcodes.length
    ? await chunked(codeBarcodes, 100, (part) =>
        db
          .from("fin_documents")
          .select(boletoCols)
          .eq("household_id", household.id)
          .eq("status", "confirmado")
          .eq("kind", "boleto")
          .not("bill_id", "is", null)
          .in("barcode", part),
      )
    : [];
  const boletoMap = new Map<string, BaixaBoleto>();
  for (const b of [...(monthBoletos ?? []), ...codeBoletos]) {
    if (!b.bill_id || !b.bill_month) continue;
    boletoMap.set(`${b.bill_id}:${b.bill_month}`, { ...b, bill_id: b.bill_id, bill_month: b.bill_month, amount: b.amount === null ? null : Number(b.amount) });
  }
  const boletos = [...boletoMap.values()];

  // Pagamentos: dos meses envolvidos e de qualquer mês que já use um destes lançamentos.
  const payMonths = [...new Set([...sorted, ...boletos.map((b) => b.bill_month)])];
  const [{ data: monthPays }, txPays] = await Promise.all([
    db.from("fin_bill_payments").select("bill_id, month, transaction_id").eq("household_id", household.id).in("month", payMonths),
    chunked(txIds, 300, (part) =>
      db.from("fin_bill_payments").select("bill_id, month, transaction_id").eq("household_id", household.id).in("transaction_id", part),
    ),
  ]);
  const payments: BaixaPayment[] = [...(monthPays ?? []), ...txPays];

  const oneOffs = await loadOneOffs(db, household.id, (monthOneOffs ?? []) as OneOffRow[], txIds, codeBarcodes);
  const [ignored, oneOffIgnored] = await Promise.all([ignoredPairs(db, household.id, txIds), ignoredOneOffPairs(db, household.id, txIds)]);
  return { months: sorted, bills, boletos, txs, payments, ignored, oneOffs, oneOffIgnored };
}

/**
 * Avulsas do cruzamento: as dos meses, as já ligadas a estes lançamentos (para não reaproveitá-los) e as
 * dos boletos com os códigos recebidos; cada uma com o código e o beneficiário do boleto confirmado dela.
 */
async function loadOneOffs(db: Db, householdId: string, monthRows: OneOffRow[], txIds: string[], codeBarcodes: string[]): Promise<BaixaOneOff[]> {
  const docCols = "one_off_bill_id, barcode, payee";
  const [linkedRows, codeDocs] = await Promise.all([
    chunked<OneOffRow>(txIds, 300, (part) => db.from("fin_one_off_bills").select(ONE_OFF_COLS).eq("household_id", householdId).in("transaction_id", part)),
    chunked<{ one_off_bill_id: string | null; barcode: string | null; payee: string | null }>(codeBarcodes, 100, (part) =>
      db
        .from("fin_documents")
        .select(docCols)
        .eq("household_id", householdId)
        .eq("status", "confirmado")
        .eq("kind", "boleto")
        .not("one_off_bill_id", "is", null)
        .in("barcode", part),
    ),
  ]);
  const rows = new Map<string, OneOffRow>();
  for (const r of [...monthRows, ...linkedRows]) rows.set(r.id, r);
  const missing = [...new Set(codeDocs.map((d) => d.one_off_bill_id).filter((v): v is string => Boolean(v) && !rows.has(v!)))];
  if (missing.length) {
    const extra = await chunked<OneOffRow>(missing, 300, (part) => db.from("fin_one_off_bills").select(ONE_OFF_COLS).eq("household_id", householdId).in("id", part));
    for (const r of extra) rows.set(r.id, r);
  }
  const ids = [...rows.keys()];
  const docs = await chunked<{ one_off_bill_id: string | null; barcode: string | null; payee: string | null }>(ids, 300, (part) =>
    db.from("fin_documents").select(docCols).eq("household_id", householdId).eq("status", "confirmado").eq("kind", "boleto").in("one_off_bill_id", part),
  );
  const docOf = new Map(docs.filter((d) => d.one_off_bill_id).map((d) => [d.one_off_bill_id!, d]));
  return [...rows.values()].map((r) => ({
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    due_date: r.due_date,
    account_id: r.account_id,
    paid_on: r.paid_on,
    transaction_id: r.transaction_id,
    barcode: docOf.get(r.id)?.barcode ?? null,
    payee: docOf.get(r.id)?.payee ?? null,
  }));
}

/**
 * Cruza o extrato com as contas fixas e avulsas dos meses e grava as baixas sem ambiguidade.
 * Idempotente: pula o que já está pago/ligado e o banco recusa duplicata ((bill_id, month) e (transaction_id)
 * nas fixas; transaction_id único e "só se ainda em aberto" nas avulsas). Antes de gravar, confere de novo
 * que o lançamento não pagou outra conta (fixa ou avulsa) no meio do caminho.
 * Nunca lança erro para quem chamou (sincronização e importação não podem falhar por causa disto).
 */
export async function runBaixaAutomatica(months: string[], codes: TxCode[] = []): Promise<{ applied: BaixaMatch[]; appliedOneOff: OneOffMatch[] }> {
  try {
    const input = await loadBaixaInput(months, codes);
    if (!input) return { applied: [], appliedOneOff: [] };
    const { auto, oneOffAuto } = planBaixasComAvulsas(input);
    if (auto.length === 0 && oneOffAuto.length === 0) return { applied: [], appliedOneOff: [] };
    const { household } = await getAppContext();
    const db = await createClient();
    const applied: BaixaMatch[] = [];
    for (const m of auto) {
      const uses = await transactionUses(db, household.id, m.transaction_id);
      if (uses.oneOff.length > 0) continue;
      const { error } = await db.from("fin_bill_payments").insert({
        household_id: household.id,
        bill_id: m.bill_id,
        month: m.month,
        transaction_id: m.transaction_id,
        paid_on: m.paid_on,
        amount: m.amount,
        auto: true,
      });
      // 23505: outra pessoa (ou outra sincronização) já deu baixa ao mesmo tempo. Segue.
      if (!error) applied.push(m);
    }
    const appliedOneOff: OneOffMatch[] = [];
    for (const m of oneOffAuto) {
      const uses = await transactionUses(db, household.id, m.transaction_id);
      if (uses.fixed.length > 0 || uses.oneOff.length > 0) continue;
      const { data, error } = await db
        .from("fin_one_off_bills")
        .update({ paid_on: m.paid_on, transaction_id: m.transaction_id, paid_auto: true })
        .eq("household_id", household.id)
        .eq("id", m.one_off_bill_id)
        .is("paid_on", null)
        .select("id");
      if (!error && data?.length) appliedOneOff.push(m);
    }
    return { applied, appliedOneOff };
  } catch {
    return { applied: [], appliedOneOff: [] };
  }
}

/** Sugestões do mês para a tela Contas fixas (calculadas na hora; nada é gravado aqui). */
export async function getBaixaSuggestions(month: string): Promise<BaixaMatch[]> {
  return (await getAllBaixaSuggestions(month)).fixed;
}

/** Sugestões do mês, das fixas e das avulsas (vencimento no mês). Abrir a página não grava nada. */
export async function getAllBaixaSuggestions(month: string): Promise<{ fixed: BaixaMatch[]; oneOff: OneOffMatch[] }> {
  const input = await loadBaixaInput([month]);
  if (!input) return { fixed: [], oneOff: [] };
  const { auto, suggestions, oneOffAuto, oneOffSuggestions } = planBaixasComAvulsas(input);
  // Na tela, até o que seria automático só aparece como sugestão.
  return { fixed: [...auto, ...suggestions].filter((m) => m.month === month), oneOff: [...oneOffAuto, ...oneOffSuggestions] };
}

export type PaymentTx = { id: string; source: string; description: string; date: string };

/** Lançamentos ligados aos pagamentos e às sugestões (descrição na tela). */
export async function getPaymentTransactions(ids: string[]): Promise<Map<string, PaymentTx>> {
  const { household } = await getAppContext();
  const db = await createClient();
  const rows = ids.length
    ? await chunked(ids, 300, (part) =>
        db.from("fin_transactions").select("id, source, description, date").eq("household_id", household.id).in("id", part),
      )
    : [];
  return new Map((rows as PaymentTx[]).map((t) => [t.id, t]));
}
