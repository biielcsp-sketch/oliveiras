import { describe, expect, it } from "vitest";
import {
  itemHealthy,
  accountKindFrom, bankBalanceToApp, buildSyncRows, defaultSyncFrom, maskNumber, planSync, syncWindowStart, toAppAmount,
} from "@/lib/pluggy/normalize";

const tx = (o: Partial<Parameters<typeof toAppAmount>[0]> & Record<string, unknown>) => ({
  id: "x", date: "2026-11-05T00:00:00.000Z", description: "Mercado", amount: -10, type: "DEBIT", ...o,
});

describe("sinal", () => {
  it("conta corrente: saída negativa, entrada positiva", () => {
    expect(toAppAmount({ amount: -212.45, type: "DEBIT" })).toBe(-212.45);
    expect(toAppAmount({ amount: 8500, type: "CREDIT" })).toBe(8500);
  });
  it("cartão: compra vem positiva na Pluggy e vira saída", () => {
    expect(toAppAmount({ amount: 55.9, type: "DEBIT" })).toBe(-55.9);
    expect(toAppAmount({ amount: -500, type: "CREDIT" })).toBe(500);
  });
});

describe("linhas da sincronização", () => {
  const rules = [{ pattern: "ifood", category_id: "alim" }];

  it("usa providerId quando existe e aplica regras", () => {
    const [r] = buildSyncRows([tx({ providerId: "P1", description: "IFOOD *X" })], rules);
    expect(r).toEqual({ date: "2026-11-05", description: "IFOOD *X", amount: -10, external_id: "pluggy:p:P1", category_id: "alim" });
  });

  it("sem providerId: chave por data+valor+descrição+ocorrência, estável e sem colidir", () => {
    const list = [tx({ id: "a" }), tx({ id: "b" }), tx({ id: "c", amount: -11 })];
    const a = buildSyncRows(list, []).map((r) => r.external_id);
    const b = buildSyncRows(list.map((t) => ({ ...t, id: `novo-${t.id}` })), []).map((r) => r.external_id);
    expect(new Set(a).size).toBe(3);
    expect(a).toEqual(b); // id da Pluggy mudou (reapresentação), chave não
  });

  it("ignora valor zero e data inválida; descrição vazia vira texto padrão", () => {
    const rows = buildSyncRows([tx({ amount: 0 }), tx({ date: "ontem" }), tx({ description: null })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("Sem descrição");
  });
});

describe("plano de sincronização", () => {
  const existing = [
    { id: "1", external_id: "k1", date: "2026-11-01", amount: -10, description: "A" },
    { id: "2", external_id: "k2", date: "2026-11-02", amount: -20, description: "B pendente" },
    { id: "3", external_id: "k3", date: "2026-11-03", amount: -30, description: "C" },
  ];
  const incoming = [
    { external_id: "k1", date: "2026-11-01", amount: -10, description: "A", category_id: null },
    { external_id: "k2", date: "2026-11-02", amount: -21.5, description: "B", category_id: "x" },
    { external_id: "k4", date: "2026-11-04", amount: -40, description: "D", category_id: null },
  ];

  it("insere novos, atualiza alterados (sem mexer na categoria) e remove os que sumiram", () => {
    expect(planSync(existing, incoming)).toEqual({
      inserts: [incoming[2]],
      updates: [{ id: "2", date: "2026-11-02", amount: -21.5, description: "B" }],
      deletes: ["3"],
    });
  });

  // Regressão: com autorização vencida a Pluggy devolve lista vazia, e a sincronização
  // apagava todos os lançamentos importados da janela.
  it("leitura vazia da Pluggy não apaga nada", () => {
    expect(planSync(existing, []).deletes).toEqual([]);
  });

  it("item não saudável: insere e atualiza, mas não apaga", () => {
    const plan = planSync(existing, incoming, { allowDeletes: false });
    expect(plan.deletes).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(1);
  });

  it("nada muda quando já está igual", () => {
    expect(planSync(existing.slice(0, 1), incoming.slice(0, 1))).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

describe("contas", () => {
  it("tipo da conta", () => {
    expect(accountKindFrom({ type: "CREDIT", subtype: "CREDIT_CARD" })).toBe("cartao");
    expect(accountKindFrom({ type: "BANK", subtype: "SAVINGS_ACCOUNT" })).toBe("poupanca");
    expect(accountKindFrom({ type: "BANK", subtype: "CHECKING_ACCOUNT" })).toBe("corrente");
  });
  it("saldo do cartão vira dívida negativa", () => {
    expect(bankBalanceToApp({ type: "CREDIT", subtype: "CREDIT_CARD", balance: 1234.5 })).toBe(-1234.5);
    expect(bankBalanceToApp({ type: "BANK", subtype: "CHECKING_ACCOUNT", balance: 980 })).toBe(980);
  });
  it("mascara o número", () => expect(maskNumber("0001 12345-6")).toBe("•••• 45-6"));
});

describe("período", () => {
  it("começa depois do último lançamento importado à mão, para não duplicar", () => {
    expect(defaultSyncFrom("2026-11-06", "2026-11-08")).toBe("2026-11-07");
    expect(defaultSyncFrom(null, "2026-11-08")).toBe("2026-08-10");
  });
  it("janela de 60 dias, sem passar do início escolhido", () => {
    expect(syncWindowStart("2026-11-07", "2026-11-08")).toBe("2026-11-07");
    expect(syncWindowStart("2026-01-01", "2026-11-08")).toBe("2026-09-09");
    expect(syncWindowStart(null, "2026-11-08")).toBe("2026-09-09");
  });
});

describe("saúde do item", () => {
  const now = "2026-11-08T12:00:00.000Z";
  it.each([
    ["UPDATED", "2027-11-01T00:00:00.000Z", true],
    ["UPDATED", null, true],
    ["UPDATED", "2026-11-01T00:00:00.000Z", false],
    ["LOGIN_ERROR", "2027-11-01T00:00:00.000Z", false],
    ["UPDATING", null, false],
    ["OUTDATED", null, false],
    ["UPDATED", "2026-11-08T09:00:00-03:00", false], // mesmo instante em outro fuso
    ["UPDATED", "2026-11-08T09:00:01-03:00", true],
  ] as const)("%s, consentimento até %s → %s", (status, exp, expected) => {
    expect(itemHealthy(status, exp, now)).toBe(expected);
  });
});
