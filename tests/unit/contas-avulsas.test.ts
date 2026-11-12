import { describe, expect, it } from "vitest";
import {
  BILL_KIND_REQUIRED,
  oneOffOption,
  oneOffStatus,
  oneOffsForMonth,
  parseBillKind,
  parsePayTarget,
  txPayConflict,
  validateOneOffInput,
} from "@/lib/financas/avulsas";
import { oneOffPairKey, pairKey, planBaixas, planBaixasComAvulsas, type BaixaBill, type BaixaOneOff, type BaixaTx } from "@/lib/financas/baixa";
import { mod11Bancario, toLinhaDigitavel } from "@/lib/financas/documentos/boleto";
import { homeBillsForMonth } from "@/lib/casa/contas";
import { buildContasAPagar } from "@/lib/oli/panels";
import { oneOffDeletePath, oneOffPath } from "@/lib/financas/routes";
import { docEditBlock, ONE_OFF_BOLETO_EDIT, ORPHAN_BOLETO_EDIT } from "@/lib/financas/documentos/input";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LUZ = U(1);
const IPVA = U(2);

function barcode(dayIso: string, cents: string, livre: string) {
  const factor = 1000 + Math.round((Date.parse(`${dayIso}T00:00:00Z`) - Date.UTC(2025, 1, 22)) / 86_400_000);
  const head = "3419";
  const rest = `${factor}${cents.padStart(10, "0")}${livre}`;
  return head + mod11Bancario(head + rest) + rest;
}

const bill = (over: Partial<BaixaBill> = {}): BaixaBill => ({ id: LUZ, name: "Luz", amount: 350, due_day: 10, active: true, account_id: null, ...over });
const oneOff = (over: Partial<BaixaOneOff> = {}): BaixaOneOff => ({
  id: IPVA, name: "IPVA 2027", amount: 350, due_date: "2026-12-15", account_id: null, paid_on: null, transaction_id: null, barcode: null, payee: "SEFAZ SP", ...over,
});
const tx = (over: Partial<BaixaTx> = {}): BaixaTx => ({ id: U(100), account_id: U(50), date: "2026-12-14", amount: -350, description: "PAGTO IPVA SEFAZ", ...over });
const base = { months: ["2026-12"], boletos: [], payments: [] };

describe("conta avulsa: tipo obrigatório na conferência", () => {
  it("só aceita 'fixa' ou 'avulsa'; vazio ou outro valor não vira fixa sozinho", () => {
    expect(parseBillKind("fixa")).toBe("fixa");
    expect(parseBillKind("avulsa")).toBe("avulsa");
    for (const v of ["", "Fixa", "nova", null, undefined, 1]) expect(parseBillKind(v)).toBeNull();
    expect(BILL_KIND_REQUIRED).toMatch(/fixa.*avulsa/);
  });
});

describe("conta avulsa: validação no servidor", () => {
  const ok = { name: "IPVA 2027", amount: "1.234,56", dueDate: "2026-12-15" };
  it("aceita nome, valor em reais e vencimento", () => {
    expect(validateOneOffInput(ok)).toEqual({ ok: true, value: { name: "IPVA 2027", amount: 1234.56, due_date: "2026-12-15" } });
    expect(validateOneOffInput({ ...ok, name: "  Multa  " })).toMatchObject({ ok: true, value: { name: "Multa" } });
  });
  it("recusa nome vazio ou longo, valor inválido e data inexistente (mesmos limites do banco)", () => {
    expect(validateOneOffInput({ ...ok, name: " " })).toEqual({ ok: false, erro: "Dê um nome à conta avulsa (até 60 letras)." });
    expect(validateOneOffInput({ ...ok, name: "x".repeat(61) }).ok).toBe(false);
    for (const amount of ["", "0", "-5", "abc", "10000000,01"]) expect(validateOneOffInput({ ...ok, amount })).toEqual({ ok: false, erro: "Valor inválido." });
    for (const dueDate of ["", "2026-02-30", "15/12/2026"]) expect(validateOneOffInput({ ...ok, dueDate })).toEqual({ ok: false, erro: "Vencimento inválido." });
  });
});

describe("conta avulsa: status e mês", () => {
  it("status igual ao das fixas", () => {
    expect(oneOffStatus({ due_date: "2026-12-15", paid_on: null }, "2026-12-10")).toBe("a_vencer");
    expect(oneOffStatus({ due_date: "2026-12-15", paid_on: null }, "2026-12-15")).toBe("vence_hoje");
    expect(oneOffStatus({ due_date: "2026-12-15", paid_on: null }, "2026-12-16")).toBe("atrasada");
    expect(oneOffStatus({ due_date: "2026-12-15", paid_on: "2026-12-20" }, "2026-12-30")).toBe("paga");
  });
  it("aparece só no mês do vencimento; em Casa só as da casa", () => {
    const list = [
      { id: "a", name: "B", due_date: "2026-12-20", is_home: true },
      { id: "b", name: "A", due_date: "2026-12-05", is_home: false },
      { id: "c", name: "C", due_date: "2027-01-02", is_home: true },
    ];
    expect(oneOffsForMonth(list, "2026-12").map((o) => o.id)).toEqual(["b", "a"]);
    expect(oneOffsForMonth(list, "2026-12", true).map((o) => o.id)).toEqual(["a"]);
    expect(oneOffsForMonth(list, "2027-01").map((o) => o.id)).toEqual(["c"]);
  });
  it("rotas fixas (sem ecoar valor da URL)", () => {
    expect(oneOffPath(IPVA)).toBe(`/financas/contas-fixas/avulsa/${IPVA}`);
    expect(oneOffDeletePath(IPVA, "casa", "2026-12")).toBe(`/financas/contas-fixas/avulsa/${IPVA}/excluir?voltar=casa&mes=2026-12`);
    expect(oneOffDeletePath(IPVA, "https://x.com", "javascript:1")).toBe(`/financas/contas-fixas/avulsa/${IPVA}/excluir`);
  });
});

describe("comprovante: conta a marcar como paga (fixa ou avulsa)", () => {
  it("vazio, fixa com mês ou avulsa sem mês", () => {
    expect(parsePayTarget("", "")).toEqual({ ok: true, value: null });
    expect(parsePayTarget(LUZ, "2026-12")).toEqual({ ok: true, value: { kind: "fixa", billId: LUZ, month: "2026-12" } });
    expect(parsePayTarget(oneOffOption(IPVA), "")).toEqual({ ok: true, value: { kind: "avulsa", id: IPVA } });
  });
  it("recusa id inválido e fixa sem mês", () => {
    expect(parsePayTarget("avulsa:xyz", "")).toEqual({ ok: false, erro: "Conta avulsa inválida." });
    expect(parsePayTarget("nao-uuid", "2026-12")).toEqual({ ok: false, erro: "Conta fixa inválida." });
    expect(parsePayTarget(LUZ, "")).toEqual({ ok: false, erro: "Informe o mês da conta paga (AAAA-MM)." });
  });
});

describe("um lançamento não paga duas contas (fixa e avulsa)", () => {
  const none = { fixed: [], oneOff: [] };
  it("lançamento livre pode pagar qualquer uma", () => {
    expect(txPayConflict({ kind: "fixa", billId: LUZ, month: "2026-12" }, none)).toBeNull();
    expect(txPayConflict({ kind: "avulsa", id: IPVA }, none)).toBeNull();
  });
  it("já pagou uma avulsa: não paga fixa nem outra avulsa", () => {
    const uses = { fixed: [], oneOff: [{ id: IPVA }] };
    expect(txPayConflict({ kind: "fixa", billId: LUZ, month: "2026-12" }, uses)).toMatch(/já pagou uma conta avulsa/);
    expect(txPayConflict({ kind: "avulsa", id: U(3) }, uses)).toMatch(/já pagou outra conta avulsa/);
  });
  it("já pagou uma fixa: não paga avulsa nem outra fixa/mês", () => {
    const uses = { fixed: [{ bill_id: LUZ, month: "2026-12" }], oneOff: [] };
    expect(txPayConflict({ kind: "avulsa", id: IPVA }, uses)).toMatch(/já pagou uma conta fixa/);
    expect(txPayConflict({ kind: "fixa", billId: U(4), month: "2026-12" }, uses)).toMatch(/já pagou outra conta fixa/);
    expect(txPayConflict({ kind: "fixa", billId: LUZ, month: "2027-01" }, uses)).toMatch(/já pagou outra conta fixa/);
  });
});

describe("baixa automática das avulsas", () => {
  it("valor exato + vencimento ±10 dias + descrição parecida: baixa automática", () => {
    const r = planBaixasComAvulsas({ ...base, bills: [], txs: [tx()], oneOffs: [oneOff()] });
    expect(r.oneOffAuto).toEqual([{ one_off_bill_id: IPVA, transaction_id: U(100), paid_on: "2026-12-14", amount: 350, reason: "valor" }]);
    expect(r.oneOffSuggestions).toEqual([]);
  });

  it("sem descrição parecida vira sugestão; fora da janela ou valor diferente, nada", () => {
    expect(planBaixasComAvulsas({ ...base, bills: [], txs: [tx({ description: "PIX 123" })], oneOffs: [oneOff()] }).oneOffSuggestions).toHaveLength(1);
    expect(planBaixasComAvulsas({ ...base, bills: [], txs: [tx({ date: "2026-12-26" })], oneOffs: [oneOff()] }).oneOffAuto).toEqual([]);
    expect(planBaixasComAvulsas({ ...base, bills: [], txs: [tx({ date: "2026-12-26" })], oneOffs: [oneOff()] }).oneOffSuggestions).toEqual([]);
    expect(planBaixasComAvulsas({ ...base, bills: [], txs: [tx({ amount: -350.01 })], oneOffs: [oneOff()] }).oneOffSuggestions).toEqual([]);
  });

  it("código de barras do boleto da avulsa: automática mesmo com valor diferente e em outro mês", () => {
    const code = barcode("2026-12-15", "35000", "1091234567812345678955555");
    const r = planBaixasComAvulsas({
      ...base,
      months: ["2027-01"],
      bills: [],
      txs: [tx({ amount: -360, description: "DEBITO", barcode: toLinhaDigitavel(code), date: "2027-01-03" })],
      oneOffs: [oneOff({ barcode: code })],
    });
    expect(r.oneOffAuto).toEqual([{ one_off_bill_id: IPVA, transaction_id: U(100), paid_on: "2027-01-03", amount: 360, reason: "codigo" }]);
  });

  it("paga, de outra conta bancária, de outro mês ou recusada ('Não é'/desfeita): fica de fora", () => {
    expect(planBaixasComAvulsas({ ...base, bills: [], txs: [tx()], oneOffs: [oneOff({ paid_on: "2026-12-01" })] }).oneOffAuto).toEqual([]);
    expect(planBaixasComAvulsas({ ...base, bills: [], txs: [tx()], oneOffs: [oneOff({ account_id: U(51) })] }).oneOffAuto).toEqual([]);
    expect(planBaixasComAvulsas({ ...base, months: ["2027-01"], bills: [], txs: [tx()], oneOffs: [oneOff()] }).oneOffAuto).toEqual([]);
    const oneOffIgnored = new Set([oneOffPairKey({ one_off_bill_id: IPVA, transaction_id: U(100) })]);
    const r = planBaixasComAvulsas({ ...base, bills: [], txs: [tx()], oneOffs: [oneOff()], oneOffIgnored });
    expect([...r.oneOffAuto, ...r.oneOffSuggestions]).toEqual([]);
  });

  it("lançamento já ligado a uma fixa não paga avulsa, e vice-versa", () => {
    const paidFixed = planBaixasComAvulsas({
      ...base,
      bills: [bill()],
      payments: [{ bill_id: LUZ, month: "2026-11", transaction_id: U(100) }],
      txs: [tx()],
      oneOffs: [oneOff()],
    });
    expect([...paidFixed.oneOffAuto, ...paidFixed.oneOffSuggestions, ...paidFixed.auto, ...paidFixed.suggestions]).toEqual([]);

    const paidOneOff = planBaixasComAvulsas({
      ...base,
      bills: [bill({ name: "IPVA mensal" })],
      txs: [tx()],
      oneOffs: [oneOff({ id: U(9), paid_on: "2026-12-14", transaction_id: U(100), due_date: "2026-11-30" })],
    });
    expect([...paidOneOff.auto, ...paidOneOff.suggestions]).toEqual([]);
  });

  it("mesmo lançamento serve para uma fixa e uma avulsa: só sugestão nas duas, nunca baixa automática", () => {
    const r = planBaixasComAvulsas({ ...base, bills: [bill({ name: "IPVA parcelado", due_day: 12 })], txs: [tx()], oneOffs: [oneOff()] });
    expect(r.auto).toEqual([]);
    expect(r.oneOffAuto).toEqual([]);
    expect(r.suggestions.map((m) => [m.bill_id, m.transaction_id])).toEqual([[LUZ, U(100)]]);
    expect(r.oneOffSuggestions.map((m) => [m.one_off_bill_id, m.transaction_id])).toEqual([[IPVA, U(100)]]);
  });

  it("código de uma fixa usa o lançamento: a avulsa com o mesmo valor não o recebe", () => {
    const code = barcode("2026-12-10", "35000", "1091234567812345678901230");
    const r = planBaixasComAvulsas({
      ...base,
      bills: [bill()],
      boletos: [{ bill_id: LUZ, bill_month: "2026-12", amount: 350, due_date: "2026-12-10", barcode: code, payee: "ENEL" }],
      txs: [tx({ barcode: code })],
      oneOffs: [oneOff()],
    });
    expect(r.auto.map((m) => m.reason)).toEqual(["codigo"]);
    expect([...r.oneOffAuto, ...r.oneOffSuggestions]).toEqual([]);
  });

  it("sem avulsas, planBaixas devolve exatamente o mesmo de antes", () => {
    const input = { ...base, bills: [bill({ amount: 350 })], txs: [tx({ description: "CONTA LUZ" })], ignored: new Set<string>([pairKey({ bill_id: U(7), transaction_id: U(8) })]) };
    const { auto, suggestions } = planBaixasComAvulsas(input);
    expect(planBaixas(input)).toEqual({ auto, suggestions });
    expect(auto).toHaveLength(1);
  });
});

describe("Casa > Contas com avulsas da casa", () => {
  it("inclui as avulsas da casa do mês, com status e boleto; fixas seguem iguais", () => {
    const rows = homeBillsForMonth({
      bills: [{ id: LUZ, name: "Luz", amount: 100, due_day: 10, active: true, is_home: true }],
      payments: [],
      docs: new Map(),
      oneOffs: [
        { id: IPVA, name: "Conserto portão", amount: 480, due_date: "2026-12-05", is_home: true, paid_on: null },
        { id: U(3), name: "Multa", amount: 90, due_date: "2026-12-06", is_home: false, paid_on: null },
        { id: U(4), name: "Gás extra", amount: 50, due_date: "2027-01-06", is_home: true, paid_on: null },
        { id: U(5), name: "Pintura", amount: 900, due_date: "2026-12-20", is_home: true, paid_on: "2026-12-19" },
      ],
      oneOffDocs: new Map([[IPVA, { id: U(60), file_mime: "application/pdf" }]]),
      oneOffSuggestionIds: [IPVA, U(5)],
      month: "2026-12",
      today: "2026-12-08",
    });
    expect(rows.map((r) => [r.kind, r.name, r.status, r.amount, r.suggestions])).toEqual([
      ["avulsa", "Conserto portão", "atrasada", 480, 1],
      ["fixa", "Luz", "em_aberto", 100, 0],
      ["avulsa", "Pintura", "paga", 900, 0],
    ]);
    expect(rows[0].doc).toEqual({ id: U(60), mime: "application/pdf" });
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(1480);
  });
});

describe("Oli: contas a pagar com avulsas em aberto", () => {
  it("avulsas não pagas que vencem até o fim do mês (inclui atrasadas), marcadas como avulsa", () => {
    const d = buildContasAPagar({
      month: "2026-12",
      today: "2026-12-08",
      bills: [],
      payments: [],
      accounts: [],
      categories: [],
      cardTxs: [],
      oneOffs: [
        { name: "IPVA", amount: 350, due_date: "2026-12-15", paid_on: null },
        { name: "Multa antiga", amount: 90, due_date: "2026-11-20", paid_on: null },
        { name: "Paga", amount: 10, due_date: "2026-12-01", paid_on: "2026-12-01" },
        { name: "Futura", amount: 70, due_date: "2027-01-05", paid_on: null },
      ],
    });
    expect(d.contas).toEqual([
      { nome: "Multa antiga", valor: 90, vencimento: "2026-11-20", status: "atrasada", fatura: false, avulsa: true },
      { nome: "IPVA", valor: 350, vencimento: "2026-12-15", status: "a_vencer", fatura: false, avulsa: true },
    ]);
    expect(d.total_pendente).toBe(440);
  });
});

describe("resumo da Casa: contagem com avulsas da casa", () => {
  it("avulsas da casa do mês entram em em aberto/atrasadas; as de fora da casa, pagas ou de outro mês, não", async () => {
    const { homeBillCounts } = await import("@/lib/casa/contas");
    const rows = homeBillsForMonth({
      bills: [{ id: LUZ, name: "Luz", amount: 100, due_day: 20, active: true, is_home: true }],
      payments: [],
      docs: new Map(),
      oneOffs: [
        { id: IPVA, name: "Portão", amount: 480, due_date: "2026-12-05", is_home: true, paid_on: null },
        { id: U(3), name: "Pintura", amount: 900, due_date: "2026-12-25", is_home: true, paid_on: null },
        { id: U(4), name: "Multa", amount: 90, due_date: "2026-12-01", is_home: false, paid_on: null },
        { id: U(5), name: "Gás", amount: 50, due_date: "2026-12-02", is_home: true, paid_on: "2026-12-02" },
        { id: U(6), name: "Janeiro", amount: 50, due_date: "2027-01-02", is_home: true, paid_on: null },
      ],
      month: "2026-12",
      today: "2026-12-08",
    });
    // Sem avulsas seria { open: 1, late: 0 } (só a Luz).
    expect(homeBillCounts(rows)).toEqual({ open: 2, late: 1 });
  });
});

describe("mensagens de baixa automática: fixas + avulsas", () => {
  it("countBaixas soma as duas listas (sincronização e botão do extrato)", async () => {
    const { countBaixas } = await import("@/lib/financas/baixa");
    expect(countBaixas({ applied: [1, 2], appliedOneOff: [3] })).toBe(3);
    expect(countBaixas({ applied: [], appliedOneOff: [] })).toBe(0);
    expect(countBaixas({ applied: [1] })).toBe(1);
  });
  it("baixaLabels (importação OFX/CSV) lista fixas e avulsas, avulsa no mês do vencimento", async () => {
    const { baixaLabels } = await import("@/lib/financas/baixa");
    expect(
      baixaLabels(
        [{ bill_id: LUZ, month: "2026-12" }],
        [{ one_off_bill_id: IPVA, paid_on: "2027-01-03" }, { one_off_bill_id: U(9), paid_on: "2026-12-20" }],
        new Map([[LUZ, "Luz"]]),
        new Map([[IPVA, { name: "IPVA", due_date: "2026-12-15" }]]),
      ),
    ).toEqual([
      { bill: "Luz", month: "2026-12" },
      { bill: "IPVA (avulsa)", month: "2026-12" },
      { bill: "Conta (avulsa)", month: "2026-12" },
    ]);
  });
});

describe("Editar documento: boleto de avulsa apagada não vira boleto de conta fixa", () => {
  const BILL = "11111111-1111-4111-8111-111111111111";
  const ONE = "22222222-2222-4222-8222-222222222222";
  const doc = (over: Partial<Parameters<typeof docEditBlock>[0]> = {}) => ({
    status: "confirmado", kind: "boleto", bill_id: BILL, bill_month: "2026-12", one_off_bill_id: null, ...over,
  });

  it("boleto de conta fixa e comprovante continuam editáveis", () => {
    expect(docEditBlock(doc())).toBeNull();
    expect(docEditBlock(doc({ kind: "comprovante", bill_id: null, bill_month: null }))).toBeNull();
  });

  it("boleto de conta fixa apagada (FK zera só bill_id, mês fica) continua editável para escolher outra conta", () => {
    expect(docEditBlock(doc({ bill_id: null }))).toBeNull();
  });

  it("boleto de avulsa se edita pela avulsa", () => {
    expect(docEditBlock(doc({ bill_id: null, bill_month: null, one_off_bill_id: ONE }))).toBe(ONE_OFF_BOLETO_EDIT);
  });

  it("avulsa apagada (sem bill_id, sem mês, sem one_off_bill_id): recusa com mensagem clara", () => {
    expect(docEditBlock(doc({ bill_id: null, bill_month: null, one_off_bill_id: null }))).toBe(ORPHAN_BOLETO_EDIT);
  });

  it("pendente, descartado e 'outro' não se editam", () => {
    expect(docEditBlock(doc({ status: "pendente" }))).toMatch(/confirmados/);
    expect(docEditBlock(doc({ status: "descartado" }))).toMatch(/confirmados/);
    expect(docEditBlock(doc({ kind: "outro", bill_id: null, bill_month: null }))).toMatch(/não tem dados/);
  });
});
