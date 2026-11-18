import { describe, expect, it } from "vitest";
import {
  buildHistory, categorize, categoryIdsByName, cleanDescription, matchCategory, pluggyToAppCategoryName,
} from "@/lib/financas/rules";
import { buildImportRows } from "@/lib/financas/import";
import { buildSyncRows } from "@/lib/pluggy/normalize";

describe("matchCategory por palavras inteiras", () => {
  const rules = [
    { pattern: "ifood", category_id: "alim" },
    { pattern: "tim", category_id: "tel" },
    { pattern: "99 ride", category_id: "transp" },
    { pattern: "uber", category_id: "transp" },
    { pattern: "uber eats", category_id: "alim" },
  ];
  it("'IFD*IFOOD' casa 'ifood'", () => expect(matchCategory("IFD*IFOOD", rules)).toBe("alim"));
  it("'otimo' não casa 'tim'", () => expect(matchCategory("Restaurante Otimo", rules)).toBeNull());
  it("'TIM S/A' casa 'tim'", () => expect(matchCategory("TIM S/A", rules)).toBe("tel"));
  it("'Dl *99 Ride' casa '99 ride'", () => expect(matchCategory("Dl *99 Ride", rules)).toBe("transp"));
  it("padrão mais longo vence", () => expect(matchCategory("UBER EATS *PEDIDO", rules)).toBe("alim"));
  it("parte de palavra não casa", () => expect(matchCategory("SUBERBAR", rules)).toBeNull());
});

describe("cleanDescription", () => {
  it("tira prefixos de extrato e data", () => expect(cleanDescription("COMPRA ELO DEBITO VISTA - PADARIA SOL 12/03")).toBe("padaria sol"));
  it("mantém número de marca no começo", () => expect(cleanDescription("Dl *99 Ride")).toBe("99 ride"));
  it("tira parcela e números longos", () => {
    expect(cleanDescription("LOJA AZUL 02/10")).toBe("loja azul");
    expect(cleanDescription("Loja Azul parc 3")).toBe("loja azul");
    expect(cleanDescription("IFD*IFOOD 123456")).toBe("ifood");
  });
  it("mantém nome de pessoa em Pix", () => expect(cleanDescription("PIX ENVIADO Fulano Tal")).toBe("pix enviado fulano tal"));
  it("vazia quando sobra menos de 2 letras", () => {
    expect(cleanDescription("12/03 4567")).toBe("");
    expect(cleanDescription("COMPRA X")).toBe("");
  });
  it("corta em 60", () => expect(cleanDescription("a".repeat(80)).length).toBe(60));
});

describe("pluggyToAppCategoryName", () => {
  it("mapeia categorias conhecidas sem diferenciar maiúsculas", () => {
    expect(pluggyToAppCategoryName("Credit card payment")).toBe("Pagamento Cartão de Crédito");
    expect(pluggyToAppCategoryName("same person transfer - pix")).toBe("Transferência entre contas");
    expect(pluggyToAppCategoryName("Groceries")).toBe("Mercado");
    expect(pluggyToAppCategoryName("Pharmacy")).toBe("Saúde");
    expect(pluggyToAppCategoryName("Fixed income")).toBe("Aplicação e resgate");
  });
  it("transferência para terceiros e desconhecida → null", () => {
    expect(pluggyToAppCategoryName("Transfer - PIX")).toBeNull();
    expect(pluggyToAppCategoryName("Third-party transfers")).toBeNull();
    expect(pluggyToAppCategoryName(null)).toBeNull();
  });
});

describe("buildHistory", () => {
  it("usa só manual/legado e pega a mais frequente; empate = primeira da lista (mais recente)", () => {
    const h = buildHistory([
      { description: "PADARIA SOL 12/03", category_id: "lanche", category_source: "manual" },
      { description: "Padaria Sol 15/03", category_id: "mercado", category_source: null },
      { description: "PADARIA SOL", category_id: "mercado", category_source: "manual" },
      { description: "PADARIA SOL", category_id: "outra", category_source: "regra" },
      { description: "PADARIA SOL", category_id: "outra", category_source: "pluggy" },
      { description: "LOJA AZUL", category_id: "a", category_source: "manual" },
      { description: "LOJA AZUL", category_id: "b", category_source: "manual" },
      { description: "SEM CAT", category_id: null, category_source: null },
    ]);
    expect(h.get("padaria sol")).toBe("mercado");
    expect(h.get("loja azul")).toBe("a");
    expect(h.has("sem cat")).toBe(false);
  });
});

describe("categorize: regra → histórico → Pluggy → nada", () => {
  const ctx = {
    rules: [{ pattern: "padaria", category_id: "regra-cat" }],
    history: new Map([["loja azul", "hist-cat"]]),
    categoryIdByName: categoryIdsByName([{ id: "merc", name: "Mercado" }]),
  };
  it("regra primeiro", () =>
    expect(categorize({ description: "PADARIA SOL", pluggyCategory: "Groceries" }, ctx)).toEqual({ category_id: "regra-cat", category_source: "regra" }));
  it("depois histórico", () =>
    expect(categorize({ description: "LOJA AZUL 02/10", pluggyCategory: "Groceries" }, ctx)).toEqual({ category_id: "hist-cat", category_source: "historico" }));
  it("depois Pluggy, se a categoria existir na família", () => {
    expect(categorize({ description: "XYZ COMERCIO", pluggyCategory: "Groceries" }, ctx)).toEqual({ category_id: "merc", category_source: "pluggy" });
    expect(categorize({ description: "XYZ COMERCIO", pluggyCategory: "Pharmacy" }, ctx)).toEqual({ category_id: null, category_source: null });
  });
  it("nada", () => expect(categorize({ description: "XYZ COMERCIO" }, ctx)).toEqual({ category_id: null, category_source: null }));

  it("importação e sincronização usam categorize e gravam a origem", () => {
    const [imp] = buildImportRows([{ date: "2026-11-01", description: "LOJA AZUL", amount: -5, externalId: null }], {
      invert: false, rules: [], history: ctx.history,
    });
    expect(imp).toMatchObject({ category_id: "hist-cat", category_source: "historico" });
    const [sync] = buildSyncRows(
      [{ id: "1", date: "2026-11-01", description: "XYZ COMERCIO", amount: 5, type: "DEBIT", category: "Groceries" }],
      ctx,
    );
    expect(sync).toMatchObject({ category_id: "merc", category_source: "pluggy", pluggy_category: "Groceries" });
  });
});

// Regressão: a regra aprendida (texto = cleanDescription) não casava com a própria descrição quando
// havia número no meio ('LOJA 123 CENTRO' → 'loja centro').
describe("regra aprendida sempre casa com a descrição de onde veio", () => {
  const descs = [
    "LOJA 123 CENTRO",
    "COMPRA ELO DEBITO VISTA - PADARIA SOL 12/03",
    "MERCADINHO 2000 BAIRRO NOVO",
    "IFD*IFOOD 123456",
    "Dl *99 Ride",
    "LOJA AZUL PARC 03/10 SHOPPING",
    "PG *POSTO ESTRELA 4521 KM 30",
    "COMPRA ELO DEBITO VISTA - ACOUGUE BOI 1 FILIAL 7",
  ];
  for (const d of descs) {
    it(d, () => {
      const pattern = cleanDescription(d);
      expect(pattern).not.toBe("");
      expect(matchCategory(d, [{ pattern, category_id: "cat" }])).toBe("cat");
    });
  }
});
