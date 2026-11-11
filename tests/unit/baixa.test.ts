import { describe, expect, it } from "vitest";
import {
  BAIXA_WINDOW_AFTER,
  BAIXA_WINDOW_BEFORE,
  descriptionMatches,
  monthsAround,
  pairKey,
  planBaixas,
  toBarcode44,
  type BaixaBill,
  type BaixaBoleto,
  type BaixaPayment,
  type BaixaTx,
} from "@/lib/financas/baixa";
import { mod11Bancario, parseBoleto, toLinhaDigitavel } from "@/lib/financas/documentos/boleto";
import { boletoCodeOf, buildSyncRows, syncRowCodes, type PluggyTransaction } from "@/lib/pluggy/normalize";
import { legacyContasPath } from "@/lib/financas/routes";
import { boletoEditConflict, editSaveError, validateBoletoEdit, validateComprovanteEdit } from "@/lib/financas/documentos/input";
import { planDocDelete, retry, type DocRef } from "@/lib/financas/documentos/rules";
import { OLI_PERSONA, OLI_TOOLS } from "@/lib/oli/prompt";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LUZ = U(1);
const AGUA = U(2);

/** Boleto bancário sintético com DV correto (fator do ciclo iniciado em 22/02/2025). */
function barcode(dayIso: string, cents: string, livre: string) {
  const factor = 1000 + Math.round((Date.parse(`${dayIso}T00:00:00Z`) - Date.UTC(2025, 1, 22)) / 86_400_000);
  const head = "3419";
  const rest = `${factor}${cents.padStart(10, "0")}${livre}`;
  return head + mod11Bancario(head + rest) + rest;
}
const CODE = barcode("2026-12-10", "18790", "1091234567812345678901230");
const LINHA = toLinhaDigitavel(CODE)!;

const bill = (over: Partial<BaixaBill> = {}): BaixaBill => ({ id: LUZ, name: "Luz", amount: 100, due_day: 10, active: true, account_id: null, ...over });
const tx = (over: Partial<BaixaTx> = {}): BaixaTx => ({ id: U(100), account_id: U(50), date: "2026-12-09", amount: -187.9, description: "PAG BOLETO ENEL LUZ", ...over });
const boleto = (over: Partial<BaixaBoleto> = {}): BaixaBoleto => ({
  bill_id: LUZ, bill_month: "2026-12", amount: 187.9, due_date: "2026-12-10", barcode: CODE, payee: "ENEL Distribuição", ...over,
});

describe("baixa automática: código de barras", () => {
  it("linha digitável e código de barras viram os mesmos 44 dígitos (com DV conferido)", () => {
    expect(LINHA).toHaveLength(47);
    expect(toBarcode44(LINHA, "2026-12-09")).toBe(CODE);
    expect(toBarcode44(CODE, "2026-12-09")).toBe(CODE);
    expect(toBarcode44(LINHA.replace(/(\d{5})(\d{5})/, "$1.$2 "), "2026-12-09")).toBe(CODE);
    expect(parseBoleto(LINHA, "2026-12-09").ok).toBe(true);
    // DV errado, curto demais ou vazio: não compara dígitos soltos.
    expect(toBarcode44(CODE.slice(0, 4) + ((Number(CODE[4]) + 1) % 10) + CODE.slice(5), "2026-12-09")).toBeNull();
    expect(toBarcode44("123", "2026-12-09")).toBeNull();
    expect(toBarcode44(null, "2026-12-09")).toBeNull();
  });

  it("código igual dá baixa sempre, mesmo com valor diferente (juros) e descrição sem nada a ver", () => {
    const r = planBaixas({
      months: ["2026-12"],
      bills: [bill()],
      boletos: [boleto()],
      txs: [tx({ amount: -190.12, description: "DEBITO 123", barcode: LINHA, date: "2026-12-20" })],
      payments: [],
    });
    expect(r.auto).toEqual([{ bill_id: LUZ, month: "2026-12", transaction_id: U(100), paid_on: "2026-12-20", amount: 190.12, reason: "codigo" }]);
    expect(r.suggestions).toEqual([]);
  });

  it("código igual mas conta já paga no mês: não duplica", () => {
    const r = planBaixas({
      months: ["2026-12"],
      bills: [bill()],
      boletos: [boleto()],
      txs: [tx({ barcode: CODE })],
      payments: [{ bill_id: LUZ, month: "2026-12", transaction_id: null }],
    });
    expect(r.auto).toEqual([]);
  });

  it("Pluggy: lê paymentData.boletoMetadata (barcode ou digitableLine) e liga ao external_id da saída", () => {
    const base: PluggyTransaction = { id: "p1", date: "2026-12-09T00:00:00.000Z", description: "Pagamento de boleto", amount: 187.9, type: "DEBIT" };
    expect(boletoCodeOf({ ...base, paymentData: { boletoMetadata: { digitableLine: LINHA } } })).toBe(CODE);
    expect(boletoCodeOf({ ...base, paymentData: { boletoMetadata: { barcode: CODE } } })).toBe(CODE);
    expect(boletoCodeOf({ ...base, paymentData: null })).toBeNull();
    expect(boletoCodeOf({ ...base, paymentData: { boletoMetadata: { digitableLine: "11190000111001113911100000021110600000000111000" } } })).toBeNull();
    const txs: PluggyTransaction[] = [
      { ...base, paymentData: { boletoMetadata: { digitableLine: LINHA } } },
      { ...base, id: "p2", amount: 0 }, // ignorado pelo buildSyncRows: os índices continuam alinhados
      { ...base, id: "p3", type: "CREDIT", paymentData: { boletoMetadata: { barcode: CODE } } }, // entrada: fora
    ];
    const rows = buildSyncRows(txs, []);
    expect(syncRowCodes(txs, rows)).toEqual([{ external_id: rows[0].external_id, barcode: CODE }]);
  });
});

describe("baixa automática: valor exato, janela e descrição", () => {
  it(`janela documentada: ${BAIXA_WINDOW_BEFORE} dias antes a ${BAIXA_WINDOW_AFTER} depois do vencimento`, () => {
    const at = (date: string) => planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null })], txs: [tx({ date })], payments: [] }).auto.length;
    expect(at("2026-11-30")).toBe(1);
    expect(at("2026-12-20")).toBe(1);
    expect(at("2026-11-29")).toBe(0);
    expect(at("2026-12-21")).toBe(0);
  });

  it("boleto do mês vale; sem boleto, vale o valor fixo da conta", () => {
    const withBoleto = planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null })], txs: [tx()], payments: [] });
    expect(withBoleto.auto).toMatchObject([{ bill_id: LUZ, month: "2026-12", amount: 187.9, reason: "valor" }]);
    const fixed = planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [], txs: [tx({ amount: -100, description: "LUZ CPFL" })], payments: [] });
    expect(fixed.auto).toMatchObject([{ bill_id: LUZ, amount: 100 }]);
    // Valor diferente em 1 centavo: nada.
    const off = planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [], txs: [tx({ amount: -100.01, description: "LUZ" })], payments: [] });
    expect(off).toEqual({ auto: [], suggestions: [] });
  });

  it("descrição parecida: sem acento/maiúscula, ignora palavras genéricas, aceita abreviação", () => {
    expect(descriptionMatches("PAG BOLETO ENEL DISTRIB", ["Luz", "ENEL Distribuição - Luz"])).toBe(true);
    expect(descriptionMatches("ÁGUA SABESP", ["agua"])).toBe(true);
    expect(descriptionMatches("PAGAMENTO BOLETO", ["Boleto do condomínio"])).toBe(false);
    expect(descriptionMatches("PIX ENVIADO JOAO", ["Luz"])).toBe(false);
  });

  it("valor e data batem mas a descrição não: vira sugestão, não baixa", () => {
    const r = planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null, payee: null })], txs: [tx({ description: "PAGTO TITULO 8812" })], payments: [] });
    expect(r.auto).toEqual([]);
    expect(r.suggestions).toMatchObject([{ bill_id: LUZ, transaction_id: U(100) }]);
  });

  it("conta com conta bancária definida só casa lançamento daquela conta", () => {
    const r = planBaixas({ months: ["2026-12"], bills: [bill({ account_id: U(51) })], boletos: [boleto({ barcode: null })], txs: [tx()], payments: [] });
    expect(r).toEqual({ auto: [], suggestions: [] });
  });
});

describe("baixa automática: ambiguidade, já pago e idempotência", () => {
  it("dois lançamentos iguais para a mesma conta: nenhuma baixa, os dois viram sugestão", () => {
    const r = planBaixas({
      months: ["2026-12"],
      bills: [bill()],
      boletos: [boleto({ barcode: null })],
      txs: [tx(), tx({ id: U(101), date: "2026-12-11" })],
      payments: [],
    });
    expect(r.auto).toEqual([]);
    expect(r.suggestions.map((s) => s.transaction_id).sort()).toEqual([U(100), U(101)]);
  });

  it("um lançamento serve para duas contas (mesmo valor e nome parecido): nenhuma baixa", () => {
    const r = planBaixas({
      months: ["2026-12"],
      bills: [bill({ amount: 100, name: "Enel casa" }), bill({ id: AGUA, amount: 100, name: "Enel sítio" })],
      boletos: [],
      txs: [tx({ amount: -100, description: "ENEL" })],
      payments: [],
    });
    expect(r.auto).toEqual([]);
    expect(r.suggestions).toHaveLength(2);
  });

  it("conta já paga no mês ou lançamento já ligado a outra conta: fora", () => {
    const paid = planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null })], txs: [tx()], payments: [{ bill_id: LUZ, month: "2026-12", transaction_id: null }] });
    expect(paid).toEqual({ auto: [], suggestions: [] });
    const linked = planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null })], txs: [tx()], payments: [{ bill_id: AGUA, month: "2026-11", transaction_id: U(100) }] });
    expect(linked).toEqual({ auto: [], suggestions: [] });
  });

  it("idempotente: rodar de novo depois de gravar não gera outra baixa", () => {
    const input = { months: ["2026-12"], bills: [bill()], boletos: [boleto()], txs: [tx({ barcode: CODE })], payments: [] as BaixaPayment[] };
    const first = planBaixas(input);
    expect(first.auto).toHaveLength(1);
    const again = planBaixas({ ...input, payments: first.auto.map((m) => ({ bill_id: m.bill_id, month: m.month, transaction_id: m.transaction_id })) });
    expect(again).toEqual({ auto: [], suggestions: [] });
  });

  it("par dispensado ('Não é' ou baixa desfeita, gravado em fin_baixa_dismissals) não volta nem como sugestão", () => {
    const ignored = new Set([pairKey({ bill_id: LUZ, transaction_id: U(100) })]);
    expect(pairKey({ bill_id: LUZ, transaction_id: U(100) })).toBe(`${LUZ}:${U(100)}`);
    expect(planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto()], txs: [tx({ barcode: CODE })], payments: [], ignored })).toEqual({ auto: [], suggestions: [] });
    expect(planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null })], txs: [tx()], payments: [], ignored })).toEqual({ auto: [], suggestions: [] });
  });

  it("entradas não contam; conta pausada sem boleto no mês não entra", () => {
    expect(planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null })], txs: [tx({ amount: 187.9 })], payments: [] }).auto).toEqual([]);
    expect(planBaixas({ months: ["2026-12"], bills: [bill({ active: false })], boletos: [], txs: [tx({ amount: -100, description: "LUZ" })], payments: [] }).auto).toEqual([]);
  });

  it("dispensa de outro lançamento ou de outra conta não bloqueia o par certo", () => {
    const ignored = new Set([pairKey({ bill_id: AGUA, transaction_id: U(100) }), pairKey({ bill_id: LUZ, transaction_id: U(999) })]);
    expect(planBaixas({ months: ["2026-12"], bills: [bill()], boletos: [boleto({ barcode: null })], txs: [tx()], payments: [], ignored }).auto).toHaveLength(1);
  });

  it("meses vizinhos cobrem a janela", () => {
    expect(monthsAround(["2026-12-05"])).toEqual(["2026-11", "2026-12"]);
    expect(monthsAround(["2026-12-25"])).toEqual(["2026-12", "2027-01"]);
    expect(monthsAround(["lixo"])).toEqual([]);
  });
});

describe("Contas a pagar virou Contas fixas", () => {
  it("Oli: ferramenta mantém o nome interno contas_a_pagar, mas o texto fala de contas fixas", () => {
    const tool = OLI_TOOLS[0].functionDeclarations!.find((f) => f.name === "contas_a_pagar");
    expect(tool?.description).toMatch(/^Contas fixas do mês/);
    expect(OLI_PERSONA).toContain("Boleto vira conta fixa");
    expect(OLI_PERSONA).not.toMatch(/conta a pagar/i);
  });
});

describe("rota antiga de contas a pagar", () => {
  it("redireciona para o equivalente em contas-fixas, mantendo a query", () => {
    expect(legacyContasPath(undefined, "")).toBe("/financas/contas-fixas");
    expect(legacyContasPath([], "?mes=2026-12")).toBe("/financas/contas-fixas?mes=2026-12");
    expect(legacyContasPath(["nova"], "")).toBe("/financas/contas-fixas/nova");
    expect(legacyContasPath([LUZ, "pagar"], "?mes=2026-12")).toBe(`/financas/contas-fixas/${LUZ}/pagar?mes=2026-12`);
    // Nada de caminho estranho nem host externo.
    expect(legacyContasPath(["..", "x"], "")).toBe("/financas/contas-fixas");
    expect(legacyContasPath(["//evil.com"], "")).toBe("/financas/contas-fixas");
  });
});

describe("editar documento confirmado", () => {
  it("boleto: valida conta, valor, vencimento e mês", () => {
    expect(validateBoletoEdit({ billId: LUZ, amount: "199,00", dueDate: "2026-12-12", billMonth: "2026-12" })).toEqual({
      ok: true, value: { bill_id: LUZ, amount: 199, due_date: "2026-12-12", bill_month: "2026-12" },
    });
    expect(validateBoletoEdit({ billId: "x", amount: "1", dueDate: "2026-12-12", billMonth: "2026-12" })).toMatchObject({ ok: false });
    expect(validateBoletoEdit({ billId: LUZ, amount: "0", dueDate: "2026-12-12", billMonth: "2026-12" })).toEqual({ ok: false, erro: "Valor inválido." });
    expect(validateBoletoEdit({ billId: LUZ, amount: "1", dueDate: "2026-02-30", billMonth: "2026-12" })).toEqual({ ok: false, erro: "Vencimento inválido." });
    expect(validateBoletoEdit({ billId: LUZ, amount: "1", dueDate: "2026-12-12", billMonth: "2026-13" })).toMatchObject({ ok: false });
  });

  it("boleto: conflito com outro confirmado na mesma conta+mês (índice único) e mensagem do 23505", () => {
    const others: DocRef[] = [
      { id: U(9), kind: "boleto", status: "confirmado", barcode: null, bill_id: LUZ, bill_month: "2027-01" },
      { id: U(8), kind: "boleto", status: "descartado", barcode: null, bill_id: LUZ, bill_month: "2026-12" },
    ];
    expect(boletoEditConflict(U(7), LUZ, "2027-01", others)).toBe("Esta conta já tem outro boleto confirmado em 01/2027. Apague ou edite o outro antes.");
    expect(boletoEditConflict(U(7), LUZ, "2026-12", others)).toBeNull(); // descartado não conta
    expect(boletoEditConflict(U(9), LUZ, "2027-01", others)).toBeNull(); // ele mesmo
    expect(editSaveError("23505")).toMatch(/já existe outro boleto confirmado para esta conta neste mês/);
    expect(editSaveError(undefined)).toBe("Não foi possível salvar. Tente de novo.");
  });

  it("comprovante: só valor, data do pagamento e favorecido", () => {
    expect(validateComprovanteEdit({ amount: "50,10", paidOn: "2026-12-08", payee: "  ENEL  " })).toEqual({ ok: true, value: { amount: 50.1, paid_on: "2026-12-08", payee: "ENEL" } });
    expect(validateComprovanteEdit({ amount: "50", paidOn: "", payee: "" })).toEqual({ ok: false, erro: "Data do pagamento inválida." });
  });
});

describe("apagar documento", () => {
  const TX = U(300);
  it("sem lançamento: só o documento", () => {
    expect(planDocDelete({ mode: "tudo", docTransactionId: null, tx: null, otherDocsWithTx: 0 })).toEqual({ transactionId: null });
  });
  it("com lançamento criado por ele: 'tudo' apaga o lançamento; 'documento' mantém", () => {
    const tx = { id: TX, source: "documento" };
    expect(planDocDelete({ mode: "tudo", docTransactionId: TX, tx, otherDocsWithTx: 0 })).toEqual({ transactionId: TX });
    expect(planDocDelete({ mode: "documento", docTransactionId: TX, tx, otherDocsWithTx: 0 })).toEqual({ transactionId: null });
  });
  it("nunca apaga lançamento que não veio do documento (Open Finance, OFX, manual) nem compartilhado", () => {
    for (const source of ["openfinance", "ofx", "csv", "manual"]) {
      expect(planDocDelete({ mode: "tudo", docTransactionId: TX, tx: { id: TX, source }, otherDocsWithTx: 0 })).toEqual({ transactionId: null });
    }
    expect(planDocDelete({ mode: "tudo", docTransactionId: TX, tx: { id: TX, source: "documento" }, otherDocsWithTx: 1 })).toEqual({ transactionId: null });
    expect(planDocDelete({ mode: "tudo", docTransactionId: TX, tx: { id: U(301), source: "documento" }, otherDocsWithTx: 0 })).toEqual({ transactionId: null });
  });
  it("arquivo: tenta de novo e informa falha (aí a linha não é apagada)", async () => {
    let calls = 0;
    expect(await retry(async () => ++calls >= 2)).toBe(true);
    expect(calls).toBe(2);
    calls = 0;
    expect(await retry(async () => { calls++; throw new Error("rede"); })).toBe(false);
    expect(calls).toBe(3);
  });
});
