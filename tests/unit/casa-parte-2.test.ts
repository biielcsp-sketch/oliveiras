import { describe, expect, it } from "vitest";
import { nameKey, parseIngredients, validateDocumentInput, validateMaintenanceInput, validateMealInput, validateProviderInput } from "@/lib/casa/input";
import { groupProviders, providerContact, telHref, whatsappHref } from "@/lib/casa/contacts";
import { casaDocPath, isCasaDocPath, warrantyAlerts, warrantyStatus } from "@/lib/casa/docs";
import { ingredientsToAdd, mondayOf, parseWeek, planWeekCopy, weekDays } from "@/lib/casa/menu";
import { homeBillCounts, homeBillsForMonth, homeStatus } from "@/lib/casa/contas";
import { CASA_TABS } from "@/lib/casa/nav";
import { activeRouteIndex } from "@/lib/arc-nav";
import { billDeleteResult } from "@/lib/financas/bill-delete";
import { billDeletePath, billReturnPath, casaContasPath, docDeletePath, docReviewPath, flowOrigin, flowReturnPath } from "@/lib/financas/routes";

const HH = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

describe("documentos e garantias", () => {
  it("valida tipo, título, datas (garantia >= compra), valor e tamanhos", () => {
    expect(validateDocumentInput({ kind: "garantia", title: " Geladeira ", amount: "3.499,90", purchase_date: "2026-01-10", warranty_until: "2027-01-10" })).toEqual({
      ok: true,
      value: { kind: "garantia", title: "Geladeira", product: null, store: null, purchase_date: "2026-01-10", warranty_until: "2027-01-10", amount: 3499.9, notes: null },
    });
    expect(validateDocumentInput({ kind: "boleto", title: "x" }).ok).toBe(false);
    expect(validateDocumentInput({ kind: "manual", title: "" }).ok).toBe(false);
    expect(validateDocumentInput({ kind: "manual", title: "x".repeat(121) }).ok).toBe(false);
    expect(validateDocumentInput({ kind: "manual", title: "TV", notes: "x".repeat(1001) }).ok).toBe(false);
    expect(validateDocumentInput({ kind: "garantia", title: "TV", purchase_date: "2026-05-10", warranty_until: "2026-05-09" })).toEqual({
      ok: false,
      erro: "A garantia não pode terminar antes da compra.",
    });
    expect(validateDocumentInput({ kind: "garantia", title: "TV", warranty_until: "2026-02-30" }).ok).toBe(false);
    expect(validateDocumentInput({ kind: "nota_fiscal", title: "TV", amount: "-1" }).ok).toBe(false);
  });

  it("garantia: vencida (antes de hoje), vencendo (até 30 dias) ou válida", () => {
    const today = "2026-11-10";
    expect(warrantyStatus(null, today)).toBeNull();
    expect(warrantyStatus("2026-11-09", today)).toBe("vencida");
    expect(warrantyStatus("2026-11-10", today)).toBe("vencendo");
    expect(warrantyStatus("2026-12-10", today)).toBe("vencendo");
    expect(warrantyStatus("2026-12-11", today)).toBe("valida");
    const { soon, expired } = warrantyAlerts(
      [
        { id: "a", warranty_until: "2026-12-01" },
        { id: "b", warranty_until: "2026-11-20" },
        { id: "c", warranty_until: "2026-01-01" },
        { id: "d", warranty_until: "2026-10-01" },
        { id: "e", warranty_until: null },
      ],
      today,
    );
    expect(soon.map((d) => d.id)).toEqual(["b", "a"]);
    expect(expired.map((d) => d.id)).toEqual(["d", "c"]);
  });

  it("caminho do arquivo no bucket casa: {household}/docs/{uuid}.{pdf|jpg}", () => {
    expect(casaDocPath(HH, ID, "pdf")).toBe(`${HH}/docs/${ID}.pdf`);
    expect(isCasaDocPath(`${HH}/docs/${ID}.jpg`)).toBe(true);
    expect(isCasaDocPath(`${HH}/docs/../${ID}.pdf`)).toBe(false);
    expect(isCasaDocPath(`${HH}/cards/${ID}.pdf`)).toBe(false);
    expect(isCasaDocPath(`${HH}/docs/${ID}.html`)).toBe(false);
    expect(isCasaDocPath(null)).toBe(false);
  });
});

describe("prestadores: ligar e WhatsApp", () => {
  it("tel: só com dígitos (mantém o + do DDI)", () => {
    expect(telHref("(11) 98765-4321")).toBe("tel:11987654321");
    expect(telHref("+55 11 98765-4321")).toBe("tel:+5511987654321");
    expect(telHref("123")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("1234567890123456")).toBeNull();
  });
  it("wa.me: 55 em números de 10 ou 11 dígitos; com DDI usa como está; texto livre nunca entra", () => {
    expect(whatsappHref("(11) 98765-4321")).toBe("https://wa.me/5511987654321");
    expect(whatsappHref("11 3456-7890")).toBe("https://wa.me/551134567890");
    expect(whatsappHref("+55 (11) 98765-4321")).toBe("https://wa.me/5511987654321");
    expect(whatsappHref("98765-4321")).toBeNull();
    expect(whatsappHref("")).toBeNull();
    expect(whatsappHref('11987654321"><script>')).toBe("https://wa.me/5511987654321");
    expect(providerContact({ name: "João", service: "Elétrica", phone: "javascript:alert(1)" })).toMatchObject({ tel: null, whatsapp: null });
  });
  it("valida nome, telefone (dígitos, espaço, + - ( )) e e-mail", () => {
    expect(validateProviderInput({ name: " João ", service: "Elétrica", phone: "+55 (11) 98765-4321", email: "joao@exemplo.com" })).toEqual({
      ok: true,
      value: { name: "João", service: "Elétrica", phone: "+55 (11) 98765-4321", email: "joao@exemplo.com", notes: null },
    });
    expect(validateProviderInput({ name: "" }).ok).toBe(false);
    expect(validateProviderInput({ name: "João", phone: "11 9876 abc" }).ok).toBe(false);
    expect(validateProviderInput({ name: "João", phone: "1".repeat(31) }).ok).toBe(false);
    expect(validateProviderInput({ name: "João", email: "sem-arroba" }).ok).toBe(false);
    expect(validateProviderInput({ name: "João", service: "x".repeat(81) }).ok).toBe(false);
  });
  it("agrupa por serviço, sem serviço por último", () => {
    const g = groupProviders([
      { name: "Zé", service: "Pintura" },
      { name: "Ana", service: null },
      { name: "Bia", service: "Elétrica" },
      { name: "Caio", service: "Elétrica" },
    ]);
    expect(g.map((x) => x.service)).toEqual(["Elétrica", "Pintura", "Outros"]);
    expect(g[0].items.map((x) => x.name)).toEqual(["Bia", "Caio"]);
  });
  it("manutenção aceita prestador só com uuid", () => {
    const base = { name: "Filtro", interval_value: "6", interval_unit: "meses" };
    expect(validateMaintenanceInput({ ...base, provider_id: ID }, "2026-11-10")).toMatchObject({ ok: true, value: { provider_id: ID } });
    expect(validateMaintenanceInput(base, "2026-11-10")).toMatchObject({ ok: true, value: { provider_id: null } });
    expect(validateMaintenanceInput({ ...base, provider_id: "1 or 1=1" }, "2026-11-10").ok).toBe(false);
  });
});

describe("cardápio", () => {
  it("semana de segunda a domingo", () => {
    expect(mondayOf("2026-11-10")).toBe("2026-11-09"); // terça → segunda
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // domingo → segunda anterior
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(parseWeek("2026-11-12", "2026-01-01")).toBe("2026-11-09");
    expect(parseWeek("lixo", "2026-11-10")).toBe("2026-11-09");
    expect(weekDays("2026-12-28")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });
  it("valida refeição e ingredientes (um por linha, sem repetir, até 30 de até 80)", () => {
    expect(validateMealInput({ day: "2026-11-10", meal: "almoco", title: "Feijoada", ingredients: "Feijão preto\n\n feijão  preto \nLinguiça" })).toEqual({
      ok: true,
      value: { day: "2026-11-10", meal: "almoco", title: "Feijoada", ingredients: ["Feijão preto", "Linguiça"], notes: null },
    });
    expect(validateMealInput({ day: "2026-11-10", meal: "ceia", title: "x" }).ok).toBe(false);
    expect(validateMealInput({ day: "2026-13-10", meal: "cafe", title: "x" }).ok).toBe(false);
    expect(validateMealInput({ day: "2026-11-10", meal: "cafe", title: "" }).ok).toBe(false);
    expect(parseIngredients("x".repeat(81)).ok).toBe(false);
    expect(parseIngredients(Array.from({ length: 31 }, (_, i) => `item ${i}`).join("\n")).ok).toBe(false);
    expect(parseIngredients(Array.from({ length: 30 }, (_, i) => `item ${i}`).join("\n")).ok).toBe(true);
  });
  it("copiar a semana anterior: mesmo dia da semana, sem sobrescrever o que já existe", () => {
    const prev = [
      { day: "2026-11-02", meal: "almoco" as const, title: "Arroz", ingredients: ["Arroz"], notes: null },
      { day: "2026-11-08", meal: "jantar" as const, title: "Pizza", ingredients: [], notes: "sexta" },
      { day: "2026-11-03", meal: "cafe" as const, title: "Pão", ingredients: ["Pão"], notes: null },
      { day: "2026-10-26", meal: "cafe" as const, title: "Fora da semana", ingredients: [], notes: null },
    ];
    const rows = planWeekCopy(prev, [{ day: "2026-11-10", meal: "cafe" }], "2026-11-09");
    expect(rows).toEqual([
      { day: "2026-11-09", meal: "almoco", title: "Arroz", ingredients: ["Arroz"], notes: null },
      { day: "2026-11-15", meal: "jantar", title: "Pizza", ingredients: [], notes: "sexta" },
    ]);
  });
  it("ingredientes para a lista: sem repetir pendentes nem entre si (sem acento/maiúscula)", () => {
    expect(nameKey("  Feijão   PRETO ")).toBe("feijao preto");
    expect(ingredientsToAdd(["Arroz", "feijão", "Cebola", "cebola ", "Açúcar"], ["FEIJAO", "acucar"])).toEqual({ add: ["Arroz", "Cebola"], skipped: 3 });
    expect(ingredientsToAdd([], ["x"])).toEqual({ add: [], skipped: 0 });
  });
});

describe("contas da casa (regras das Finanças)", () => {
  const bill = (id: string, extra: Partial<{ is_home: boolean; active: boolean; due_day: number; amount: number }> = {}) => ({
    id,
    name: id,
    amount: 100,
    due_day: 10,
    active: true,
    is_home: true,
    ...extra,
  });
  it("só is_home; boleto do mês vale; status paga/em aberto/atrasada; pausada só se paga no mês", () => {
    const rows = homeBillsForMonth({
      bills: [bill("aluguel", { due_day: 5 }), bill("luz", { due_day: 20 }), bill("escola", { is_home: false }), bill("gas", { active: false }), bill("agua", { active: false })],
      payments: [{ bill_id: "agua", amount: 80, paid_on: "2026-11-03" }],
      docs: new Map([["luz", { id: "d1", amount: 187.9, due_date: "2026-11-22", file_mime: "application/pdf" }]]),
      suggestionBillIds: ["aluguel", "agua"],
      month: "2026-11",
      today: "2026-11-10",
    });
    expect(rows.map((r) => [r.id, r.status, r.amount, r.due, r.suggestions])).toEqual([
      ["aluguel", "atrasada", 100, "2026-11-05", 1],
      ["agua", "paga", 80, "2026-11-10", 0],
      ["luz", "em_aberto", 187.9, "2026-11-22", 0],
    ]);
    expect(homeBillCounts(rows)).toEqual({ open: 1, late: 1 });
    expect(homeStatus("vence_hoje")).toBe("em_aberto");
    expect(homeStatus("a_vencer")).toBe("em_aberto");
  });
  it("Nova conta da casa volta só para destinos fixos", () => {
    expect(billReturnPath("casa")).toBe("/casa/contas");
    expect(billReturnPath("https://exemplo.com")).toBe("/financas/contas-fixas");
    expect(billReturnPath(null)).toBe("/financas/contas-fixas");
  });
  it("origem do fluxo de documentos/exclusão: lista fechada, sem open redirect", () => {
    expect(flowOrigin("casa")).toBe("casa");
    for (const v of ["https://exemplo.com", "//evil.com", "/casa/contas", "CASA", "", null, undefined, 1]) expect(flowOrigin(v)).toBeNull();
    expect(flowReturnPath("casa", "/financas/contas-fixas?mes=2026-12", "2026-12")).toBe("/casa/contas?mes=2026-12");
    expect(flowReturnPath("casa", "/financas/documentos")).toBe("/casa/contas");
    expect(flowReturnPath("casa", "/financas/documentos", "2026-13")).toBe("/casa/contas");
    expect(flowReturnPath("//evil.com", "/financas/documentos", "2026-12")).toBe("/financas/documentos");
    expect(flowReturnPath(null, "/financas/contas-fixas?mes=2026-12", "2026-12")).toBe("/financas/contas-fixas?mes=2026-12");
    expect(casaContasPath("2026-12&x=1")).toBe("/casa/contas");
    // guardar/descartar da Casa mantêm o mês escolhido (só AAAA-MM válido)
    expect(flowReturnPath("casa", "/financas/documentos", "2027-01")).toBe("/casa/contas?mes=2027-01");
    expect(flowReturnPath("casa", "/financas/documentos", "2027-1")).toBe("/casa/contas");
    expect(flowReturnPath("casa", "/financas/documentos", "")).toBe("/casa/contas");
    expect(flowReturnPath(null, "/financas/documentos", "2027-01")).toBe("/financas/documentos");
  });
  it("resultado da exclusão da conta fixa: erro ou nada apagado nunca vira sucesso", () => {
    expect(billDeleteResult({ error: { code: "42501" }, data: null })).toEqual({
      ok: false,
      error: "Não foi possível excluir a conta. Nada foi apagado; tente de novo.",
    });
    for (const data of [null, undefined, []]) {
      const r = billDeleteResult({ error: null, data });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/^A conta não foi encontrada/);
    }
    expect(billDeleteResult({ error: null, data: [{ id: "x" }] })).toEqual({ ok: true });
  });
  it("conferência de documento enviado pela Casa abre dentro da Casa (aba Contas marcada)", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(docReviewPath(id, "casa", "2026-12")).toBe(`/casa/contas/documento/${id}?mes=2026-12`);
    expect(docReviewPath(id, "casa")).toBe(`/casa/contas/documento/${id}`);
    expect(docReviewPath(id, "casa", "2026-13")).toBe(`/casa/contas/documento/${id}`);
    expect(docReviewPath(id, "casa", "2026-12&x=1")).toBe(`/casa/contas/documento/${id}`);
    // Sem origem (Finanças, "+" do Oli) ou origem inválida: continua nas Finanças.
    expect(docReviewPath(id)).toBe(`/financas/documentos/${id}`);
    expect(docReviewPath(id, null, "2026-12")).toBe(`/financas/documentos/${id}`);
    expect(docReviewPath(id, "https://exemplo.com", "2026-12")).toBe(`/financas/documentos/${id}`);
    // Apagar o documento pela conferência da Casa também fica na Casa.
    expect(docDeletePath(id, "casa", "2026-12")).toBe(`/casa/contas/documento/${id}/apagar?mes=2026-12`);
    expect(docDeletePath(id, "casa", "2026-1")).toBe(`/casa/contas/documento/${id}/apagar`);
    expect(docDeletePath(id)).toBe(`/financas/documentos/${id}/apagar`);
    expect(docDeletePath(id, "//evil.com", "2026-12")).toBe(`/financas/documentos/${id}/apagar`);
    expect(CASA_TABS[activeRouteIndex(CASA_TABS, docDeletePath(id, "casa").split("?")[0])].key).toBe("contas");
    const path = docReviewPath(id, "casa", "2026-12").split("?")[0];
    expect(CASA_TABS[activeRouteIndex(CASA_TABS, path)].key).toBe("contas");
  });
  it("tela de exclusão da conta fixa: destino montado só com valores validados", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(billDeletePath(id)).toBe(`/financas/contas-fixas/${id}/excluir`);
    expect(billDeletePath(id, "casa", "2026-12")).toBe(`/financas/contas-fixas/${id}/excluir?voltar=casa&mes=2026-12`);
    expect(billDeletePath(id, "http://x", "abc")).toBe(`/financas/contas-fixas/${id}/excluir`);
  });
});

describe("menu da Casa", () => {
  it("abre com Resumo selecionado no centro, com abas dos dois lados", () => {
    const i = activeRouteIndex(CASA_TABS, "/casa");
    expect(CASA_TABS[i].label).toBe("Resumo");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(CASA_TABS.length - 1);
    expect(CASA_TABS.find((t) => t.href === "/casa/despensa")).toBeUndefined();
    expect(CASA_TABS[activeRouteIndex(CASA_TABS, "/casa/documentos")].key).toBe("documentos");
  });
});
