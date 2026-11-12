/**
 * Baixa automática das contas fixas pelo extrato. Funções puras (sem banco): quem grava é
 * baixa-data.ts, sempre com a sessão do usuário (RLS).
 *
 * Regras decididas pelo dono:
 * a) Código de barras do lançamento igual ao de um boleto confirmado → baixa sempre automática.
 *    (Linha digitável e código de barras são equivalentes: os dois viram os 44 dígitos.)
 * b) Sem código: valor EXATO (em centavos) igual ao do boleto confirmado do mês, ou ao valor fixo
 *    da conta se não houver boleto; data do lançamento de 10 dias antes a 10 dias depois do
 *    vencimento; descrição parecida com o nome da conta ou com o beneficiário do boleto.
 *    Só dá baixa se a conta tiver exatamente 1 lançamento candidato e esse lançamento tiver
 *    exatamente 1 conta candidata. Qualquer outro caso vira sugestão (o usuário confirma).
 * Conta já paga no mês e lançamento já ligado a outra conta ficam de fora (mesmos índices
 * únicos do banco: (bill_id, month) e (transaction_id)), então rodar de novo não duplica.
 * Contas avulsas (0021) entram no mesmo casamento: ver planBaixasComAvulsas.
 */
import { parseBoleto } from "./documentos/boleto";
import { billForMonth } from "./documentos/rules";
import { addDays } from "./planning";

/**
 * Janela de datas em volta do vencimento. 10 dias para cada lado cobre quem paga adiantado e o
 * atraso comum (incluindo fim de semana/feriado e o dia útil de compensação do boleto), e somando
 * 21 dias fica menor que qualquer mês: um lançamento cai na janela de no máximo um mês da mesma conta.
 */
export const BAIXA_WINDOW_BEFORE = 10;
export const BAIXA_WINDOW_AFTER = 10;

export type BaixaBill = { id: string; name: string; amount: number; due_day: number; active: boolean; account_id: string | null };
/** Boleto confirmado de uma conta num mês. */
export type BaixaBoleto = { bill_id: string; bill_month: string; amount: number | null; due_date: string | null; barcode: string | null; payee: string | null };
export type BaixaTx = { id: string; account_id: string; date: string; amount: number; description: string; barcode?: string | null };
export type BaixaPayment = { bill_id: string; month: string; transaction_id: string | null };

export type BaixaMatch = {
  bill_id: string;
  month: string;
  transaction_id: string;
  paid_on: string;
  /** Valor absoluto do lançamento (o que foi pago). */
  amount: number;
  reason: "codigo" | "valor";
};

/**
 * Chave de um par conta+lançamento dispensado ("Não é" ou baixa automática desfeita), como na
 * tabela fin_baixa_dismissals (unique household_id, bill_id, transaction_id).
 */
export const pairKey = (m: { bill_id: string; transaction_id: string }) => `${m.bill_id}:${m.transaction_id}`;

const cents = (v: number) => Math.round(Math.abs(v) * 100);

/**
 * Código de barras (44 dígitos) a partir de linha digitável (47/48) ou código (44).
 * Só aceita se passar nos dígitos verificadores; senão null (nada de comparar dígitos soltos).
 */
export function toBarcode44(raw: string | null | undefined, referenceIso: string): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 44 || digits.length > 48) return null;
  const r = parseBoleto(digits, referenceIso);
  return r.ok ? r.info.barras : null;
}

/* ---------- Descrição parecida ---------- */

// Palavras que aparecem em qualquer lançamento de pagamento e não identificam a conta.
const GENERIC = new Set([
  "de", "da", "do", "das", "dos", "e", "em", "para", "ltda", "sa", "me", "eireli", "cia", "companhia",
  "pagamento", "pagto", "pag", "pgto", "boleto", "boletos", "conta", "contas", "fatura", "debito", "deb", "automatico",
  "aut", "pix", "ted", "doc", "transferencia", "enviada", "enviado", "compra", "tarifa", "titulo", "titulos",
  "cobranca", "convenio", "banco", "mensalidade", "mes", "ref",
]);

function words(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
}

/**
 * Similaridade simples entre a descrição do extrato e um nome (conta ou beneficiário):
 * sem acentos e sem maiúsculas, pelo menos uma palavra significativa (3+ letras, fora de
 * palavras genéricas como "pagamento", "boleto", "pix") em comum. Aceita abreviação de banco
 * por prefixo de 4+ letras ("DISTRIB" ↔ "Distribuição").
 */
export function descriptionMatches(description: string, names: (string | null | undefined)[]) {
  const desc = words(description);
  if (desc.length === 0) return false;
  for (const name of names) {
    if (!name) continue;
    for (const w of words(name)) {
      for (const d of desc) {
        if (d === w) return true;
        const [short, long] = d.length <= w.length ? [d, w] : [w, d];
        if (short.length >= 4 && long.startsWith(short)) return true;
      }
    }
  }
  return false;
}

/* ---------- Casamento ---------- */

/**
 * Conta avulsa no cruzamento (fin_one_off_bills). Entra como mais uma "conta" com valor e vencimento
 * próprios; as já pagas só servem para saber quais lançamentos já estão ligados.
 * `barcode`/`payee`: do boleto confirmado ligado a ela (fin_documents.one_off_bill_id), se houver.
 */
export type BaixaOneOff = {
  id: string;
  name: string;
  amount: number;
  due_date: string;
  account_id: string | null;
  paid_on: string | null;
  transaction_id: string | null;
  barcode?: string | null;
  payee?: string | null;
};

export type OneOffMatch = {
  one_off_bill_id: string;
  transaction_id: string;
  paid_on: string;
  amount: number;
  reason: "codigo" | "valor";
};

/** Chave do par avulsa+lançamento dispensado (fin_one_off_baixa_dismissals: unique household, avulsa, lançamento). */
export const oneOffPairKey = (m: { one_off_bill_id: string; transaction_id: string }) => `${m.one_off_bill_id}:${m.transaction_id}`;

type Ref = { kind: "fixa"; bill_id: string; month: string } | { kind: "avulsa"; id: string };
type Slot = { key: string; ref: Ref; expected: number; due: string; accountId: string | null; names: (string | null | undefined)[] };

/**
 * Planeja as baixas para os meses informados.
 * - `auto`: pode gravar sem perguntar (código igual, ou valor+data+descrição sem ambiguidade).
 * - `suggestions`: parecidos, mas ambíguos (mais de um candidato, ou valor e data batem sem a descrição).
 * `ignored`: pares conta+lançamento dispensados pela família ("Não é" ou baixa desfeita); nunca voltam.
 */
export function planBaixas(input: {
  months: string[];
  bills: BaixaBill[];
  boletos: BaixaBoleto[];
  txs: BaixaTx[];
  payments: BaixaPayment[];
  ignored?: Set<string>;
}): { auto: BaixaMatch[]; suggestions: BaixaMatch[] } {
  const { auto, suggestions } = planBaixasComAvulsas(input);
  return { auto, suggestions };
}

/**
 * Mesmo casamento de planBaixas, com as contas avulsas em aberto como contas a mais. Fixas e avulsas
 * disputam os mesmos lançamentos: a ambiguidade conta as duas (um lançamento que serve para uma fixa e
 * para uma avulsa vira sugestão nas duas, nunca baixa automática), e um lançamento já ligado a qualquer
 * conta (fixa ou avulsa) fica de fora. Assim um lançamento nunca paga duas contas.
 * Avulsa entra pelo valor só se o vencimento cair num dos meses; pelo código, em qualquer mês.
 */
export function planBaixasComAvulsas(input: {
  months: string[];
  bills: BaixaBill[];
  boletos: BaixaBoleto[];
  txs: BaixaTx[];
  payments: BaixaPayment[];
  ignored?: Set<string>;
  oneOffs?: BaixaOneOff[];
  oneOffIgnored?: Set<string>;
}): { auto: BaixaMatch[]; suggestions: BaixaMatch[]; oneOffAuto: OneOffMatch[]; oneOffSuggestions: OneOffMatch[] } {
  const ignored = input.ignored ?? new Set<string>();
  const oneOffIgnored = input.oneOffIgnored ?? new Set<string>();
  const oneOffs = input.oneOffs ?? [];
  const paid = new Set(input.payments.map((p) => `f:${p.bill_id}:${p.month}`));
  for (const o of oneOffs) if (o.paid_on) paid.add(`a:${o.id}`);
  const linked = new Set(
    [...input.payments.map((p) => p.transaction_id), ...oneOffs.map((o) => o.transaction_id)].filter((v): v is string => Boolean(v)),
  );
  const billById = new Map(input.bills.map((b) => [b.id, b]));
  const outflows = input.txs.filter((t) => t.amount < 0 && !linked.has(t.id));
  const auto: BaixaMatch[] = [];
  const oneOffAuto: OneOffMatch[] = [];
  const usedTx = new Set<string>();
  const usedSlot = new Set<string>();
  const keyOf = (r: Ref) => (r.kind === "fixa" ? `f:${r.bill_id}:${r.month}` : `a:${r.id}`);
  const isIgnored = (r: Ref, txId: string) =>
    r.kind === "fixa"
      ? ignored.has(pairKey({ bill_id: r.bill_id, transaction_id: txId }))
      : oneOffIgnored.has(oneOffPairKey({ one_off_bill_id: r.id, transaction_id: txId }));
  const push = (r: Ref, t: BaixaTx, reason: BaixaMatch["reason"], toAuto: boolean, fixedSugg?: BaixaMatch[], oneSugg?: OneOffMatch[]) => {
    const base = { transaction_id: t.id, paid_on: t.date, amount: cents(t.amount) / 100, reason };
    if (r.kind === "fixa") (toAuto ? auto : fixedSugg!).push({ bill_id: r.bill_id, month: r.month, ...base });
    else (toAuto ? oneOffAuto : oneSugg!).push({ one_off_bill_id: r.id, ...base });
  };

  // a) Código de barras: sempre automático (o código identifica o boleto).
  const refByCode = new Map<string, Ref>();
  for (const o of oneOffs) if (o.barcode) refByCode.set(o.barcode, { kind: "avulsa", id: o.id });
  for (const b of input.boletos) if (b.barcode && billById.has(b.bill_id)) refByCode.set(b.barcode, { kind: "fixa", bill_id: b.bill_id, month: b.bill_month });
  for (const t of outflows) {
    const code = t.barcode ? toBarcode44(t.barcode, t.date) : null;
    const r = code ? refByCode.get(code) : undefined;
    if (!r) continue;
    const slot = keyOf(r);
    if (paid.has(slot) || usedSlot.has(slot) || isIgnored(r, t.id)) continue;
    push(r, t, "codigo", true);
    usedTx.add(t.id);
    usedSlot.add(slot);
  }

  // b) Valor exato + janela de datas (+ descrição para ser automático).
  const boletoOf = new Map(input.boletos.map((b) => [`${b.bill_id}:${b.bill_month}`, b]));
  const months = [...new Set(input.months)];
  const slots: Slot[] = [];
  for (const month of months) {
    for (const bill of input.bills) {
      const ref: Ref = { kind: "fixa", bill_id: bill.id, month };
      const key = keyOf(ref);
      if (paid.has(key) || usedSlot.has(key)) continue;
      const boleto = boletoOf.get(`${bill.id}:${month}`);
      // Conta pausada só entra se tiver boleto confirmado no mês (mesma regra da tela: aparece se tiver algo no mês).
      if (!bill.active && !boleto) continue;
      const { amount, due } = billForMonth(bill, month, boleto);
      slots.push({ key, ref, expected: amount, due, accountId: bill.account_id, names: [bill.name, boleto?.payee] });
    }
  }
  for (const o of oneOffs) {
    const ref: Ref = { kind: "avulsa", id: o.id };
    const key = keyOf(ref);
    if (paid.has(key) || usedSlot.has(key) || !months.includes(o.due_date.slice(0, 7))) continue;
    slots.push({ key, ref, expected: o.amount, due: o.due_date, accountId: o.account_id, names: [o.name, o.payee] });
  }

  type Pair = { slot: Slot; tx: BaixaTx; similar: boolean };
  const pairs: Pair[] = [];
  for (const slot of slots) {
    const from = addDays(slot.due, -BAIXA_WINDOW_BEFORE);
    const to = addDays(slot.due, BAIXA_WINDOW_AFTER);
    for (const t of outflows) {
      if (usedTx.has(t.id)) continue;
      if (slot.accountId && t.account_id !== slot.accountId) continue;
      if (cents(t.amount) !== cents(slot.expected)) continue;
      if (t.date < from || t.date > to) continue;
      if (isIgnored(slot.ref, t.id)) continue;
      pairs.push({ slot, tx: t, similar: descriptionMatches(t.description, slot.names) });
    }
  }

  const bySlot = new Map<string, Pair[]>();
  const byTx = new Map<string, Pair[]>();
  for (const p of pairs) {
    bySlot.set(p.slot.key, [...(bySlot.get(p.slot.key) ?? []), p]);
    byTx.set(p.tx.id, [...(byTx.get(p.tx.id) ?? []), p]);
  }

  const suggestions: BaixaMatch[] = [];
  const oneOffSuggestions: OneOffMatch[] = [];
  for (const p of pairs) {
    const unique = bySlot.get(p.slot.key)!.length === 1 && byTx.get(p.tx.id)!.length === 1;
    push(p.slot.ref, p.tx, "valor", unique && p.similar, suggestions, oneOffSuggestions);
  }
  suggestions.sort((a, b) => a.bill_id.localeCompare(b.bill_id) || a.paid_on.localeCompare(b.paid_on));
  oneOffSuggestions.sort((a, b) => a.one_off_bill_id.localeCompare(b.one_off_bill_id) || a.paid_on.localeCompare(b.paid_on));
  return { auto, suggestions, oneOffAuto, oneOffSuggestions };
}

/** Meses em que um lançamento pode ser pagamento de conta fixa: o do lançamento e os vizinhos (janela de ±10 dias). */
export function monthsAround(dates: string[]) {
  const set = new Set<string>();
  for (const d of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    set.add(addDays(d, -BAIXA_WINDOW_AFTER).slice(0, 7));
    set.add(d.slice(0, 7));
    set.add(addDays(d, BAIXA_WINDOW_BEFORE).slice(0, 7));
  }
  return [...set].sort();
}

/** Quantas baixas automáticas foram gravadas, somando fixas e avulsas (mensagens da sincronização e importação). */
export const countBaixas = (r: { applied: unknown[]; appliedOneOff?: unknown[] }) => r.applied.length + (r.appliedOneOff?.length ?? 0);

/**
 * Rótulos das baixas gravadas para a tela da importação: fixa com o mês dela; avulsa como "Nome (avulsa)"
 * com o mês do vencimento. Nome desconhecido (apagada no meio) vira "Conta".
 */
export function baixaLabels(
  applied: Pick<BaixaMatch, "bill_id" | "month">[],
  appliedOneOff: Pick<OneOffMatch, "one_off_bill_id" | "paid_on">[],
  billNames: Map<string, string>,
  oneOffs: Map<string, { name: string; due_date: string }>,
): { bill: string; month: string }[] {
  return [
    ...applied.map((m) => ({ bill: billNames.get(m.bill_id) ?? "Conta", month: m.month })),
    ...appliedOneOff.map((m) => {
      const o = oneOffs.get(m.one_off_bill_id);
      return { bill: `${o?.name ?? "Conta"} (avulsa)`, month: (o?.due_date ?? m.paid_on).slice(0, 7) };
    }),
  ];
}
