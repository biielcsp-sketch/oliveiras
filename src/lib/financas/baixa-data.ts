import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { monthRange, shiftMonth } from "./period";
import { getBills } from "./planning-data";
import { pairKey, planBaixas, type BaixaBoleto, type BaixaMatch, type BaixaPayment, type BaixaTx } from "./baixa";

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

async function chunked<T>(ids: string[], size: number, run: (part: string[]) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...((await run(ids.slice(i, i + size))).data ?? []));
  return out;
}

/** Monta a entrada do casamento para os meses (e os boletos dos códigos informados). */
export async function loadBaixaInput(months: string[], codes: TxCode[] = []) {
  const { household } = await getAppContext();
  const db: Db = await createClient();
  const sorted = [...new Set(months)].sort();
  const bills = await getBills();
  if (sorted.length === 0 || bills.length === 0) return null;

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
    chunked(
      txs.map((t) => t.id),
      300,
      (part) => db.from("fin_bill_payments").select("bill_id, month, transaction_id").eq("household_id", household.id).in("transaction_id", part),
    ),
  ]);
  const payments: BaixaPayment[] = [...(monthPays ?? []), ...txPays];

  const ignored = await ignoredPairs(db, household.id, txs.map((t) => t.id));
  return { months: sorted, bills, boletos, txs, payments, ignored };
}

/**
 * Cruza o extrato com as contas fixas dos meses e grava as baixas sem ambiguidade.
 * Idempotente: pula o que já está pago/ligado e o banco recusa duplicata ((bill_id, month) e (transaction_id)).
 * Nunca lança erro para quem chamou (sincronização e importação não podem falhar por causa disto).
 */
export async function runBaixaAutomatica(months: string[], codes: TxCode[] = []): Promise<{ applied: BaixaMatch[] }> {
  try {
    const input = await loadBaixaInput(months, codes);
    if (!input) return { applied: [] };
    const { auto } = planBaixas(input);
    if (auto.length === 0) return { applied: [] };
    const { household } = await getAppContext();
    const db = await createClient();
    const applied: BaixaMatch[] = [];
    for (const m of auto) {
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
    return { applied };
  } catch {
    return { applied: [] };
  }
}

/** Sugestões do mês para a tela Contas fixas (calculadas na hora; nada é gravado aqui). */
export async function getBaixaSuggestions(month: string): Promise<BaixaMatch[]> {
  const input = await loadBaixaInput([month]);
  if (!input) return [];
  const { auto, suggestions } = planBaixas(input);
  // Na tela, até o que seria automático só aparece como sugestão: abrir a página não grava nada.
  return [...auto, ...suggestions].filter((m) => m.month === month);
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
