import { describe, expect, it } from "vitest";
import {
  choreDbError,
  formToObject,
  parseQuantity,
  validateChoreInput,
  validateMaintenanceDone,
  validateMaintenanceInput,
  validatePantryInput,
  validateRestockQuantity,
  validateShoppingInput,
} from "@/lib/casa/input";
import {
  addMonths,
  advanceRotation,
  cleanRotation,
  completeChore,
  currentResponsible,
  daysInMonth,
  firstDueOn,
  nextDueAfter,
  nextMaintenanceDue,
  weekdayOf,
} from "@/lib/casa/schedule";
import { autoAddOutcome, choreBuckets, toggleErrorMessage, expiryStatus, frequencyLabel, groupShopping, intervalLabel, isLow, maintenanceStatus, qtyLabel, shouldAutoAdd, sortMaintenance } from "@/lib/casa/view";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const OUT = "99999999-9999-4999-8999-999999999999";

describe("parseQuantity", () => {
  it("aceita vírgula ou ponto, até 2 casas", () => {
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("1,5")).toBe(1.5);
    expect(parseQuantity("0.25")).toBe(0.25);
    expect(parseQuantity("  ")).toBeNull();
    expect(parseQuantity("1,555")).toBe("x");
    expect(parseQuantity("-1")).toBe("x");
    expect(parseQuantity("abc")).toBe("x");
  });
});

describe("validateShoppingInput", () => {
  it("só o nome é obrigatório", () => {
    expect(validateShoppingInput({ name: "  Arroz   integral " })).toEqual({
      ok: true,
      value: { name: "Arroz integral", quantity: null, unit: null, category: null, notes: null },
    });
    expect(validateShoppingInput({ name: "" })).toEqual({ ok: false, erro: "Informe o item." });
  });
  it("quantidade > 0 e limites de tamanho", () => {
    expect(validateShoppingInput({ name: "Leite", quantity: "0" }).ok).toBe(false);
    expect(validateShoppingInput({ name: "Leite", quantity: "2,5", unit: "l", category: "Mercado" })).toMatchObject({ ok: true, value: { quantity: 2.5, unit: "l", category: "Mercado" } });
    expect(validateShoppingInput({ name: "x".repeat(121) }).ok).toBe(false);
    expect(validateShoppingInput({ name: "Leite", unit: "x".repeat(21) }).ok).toBe(false);
    expect(validateShoppingInput({ name: "Leite", category: "x".repeat(41) }).ok).toBe(false);
    expect(validateShoppingInput({ name: "Leite", notes: "x".repeat(301) }).ok).toBe(false);
  });
});

describe("validatePantryInput", () => {
  it("quantidade e mínimo padrão 0; validade em data real", () => {
    expect(validatePantryInput({ name: "Arroz" })).toMatchObject({ ok: true, value: { quantity: 0, min_quantity: 0, expires_on: null } });
    expect(validatePantryInput({ name: "Arroz", quantity: "3", min_quantity: "1", expires_on: "2026-02-30" })).toEqual({ ok: false, erro: "Validade inválida." });
    expect(validatePantryInput({ name: "Arroz", quantity: "-1" }).ok).toBe(false);
    expect(validatePantryInput({ name: "Arroz", location: "x".repeat(61) }).ok).toBe(false);
  });
  it("reposição exige quantidade positiva", () => {
    expect(validateRestockQuantity("2")).toEqual({ ok: true, value: 2 });
    expect(validateRestockQuantity(1.5)).toEqual({ ok: true, value: 1.5 });
    expect(validateRestockQuantity("0").ok).toBe(false);
    expect(validateRestockQuantity("").ok).toBe(false);
  });
});

describe("validateChoreInput", () => {
  const members = [A, B];
  it("semanal exige dias; normaliza e manda null nos campos de outras frequências", () => {
    expect(validateChoreInput({ name: "Louça", frequency: "semanal", weekdays: ["3", "1", "1"], rotation: [A, B] }, members)).toEqual({
      ok: true,
      value: { name: "Louça", notes: null, frequency: "semanal", weekdays: [1, 3], month_day: null, rotation: [A, B] },
    });
    expect(validateChoreInput({ name: "Louça", frequency: "semanal", weekdays: [], rotation: [A] }, members).ok).toBe(false);
    expect(validateChoreInput({ name: "Louça", frequency: "semanal", weekdays: ["7"], rotation: [A] }, members).ok).toBe(false);
    expect(validateChoreInput({ name: "Lixo", frequency: "diaria", weekdays: ["1"], month_day: "3", rotation: [A] }, members)).toMatchObject({
      ok: true,
      value: { weekdays: null, month_day: null },
    });
  });
  it("mensal exige dia 1..31", () => {
    expect(validateChoreInput({ name: "Geladeira", frequency: "mensal", month_day: "31", rotation: [A] }, members)).toMatchObject({ ok: true, value: { month_day: 31, weekdays: null } });
    expect(validateChoreInput({ name: "Geladeira", frequency: "mensal", month_day: "32", rotation: [A] }, members).ok).toBe(false);
    expect(validateChoreInput({ name: "Geladeira", frequency: "mensal", month_day: "", rotation: [A] }, members).ok).toBe(false);
  });
  it("rodízio: só members da família, 1 a 10 posições, pode repetir pessoa", () => {
    expect(validateChoreInput({ name: "x", frequency: "diaria", rotation: [] }, members)).toEqual({ ok: false, erro: "Escolha quem participa do rodízio." });
    expect(validateChoreInput({ name: "x", frequency: "diaria", rotation: [A, OUT] }, members)).toEqual({ ok: false, erro: "Escolha pessoas da família." });
    expect(validateChoreInput({ name: "x", frequency: "diaria", rotation: ["nao-uuid"] }, members).ok).toBe(false);
    expect(validateChoreInput({ name: "x", frequency: "diaria", rotation: [A, A, B] }, members)).toMatchObject({ ok: true, value: { rotation: [A, A, B] } });
    expect(validateChoreInput({ name: "x", frequency: "diaria", rotation: Array(11).fill(A) }, members).ok).toBe(false);
    expect(validateChoreInput({ name: "x", frequency: "quinzenal", rotation: [A] }, members).ok).toBe(false);
  });
  it("mensagens claras para os erros do trigger", () => {
    expect(choreDbError("23503")).toMatch(/não é mais da família/);
    expect(choreDbError("23514")).toMatch(/inválidos/);
    expect(choreDbError(undefined)).toMatch(/Tente de novo/);
  });
  it("formToObject junta campos repetidos em lista", () => {
    const f = new FormData();
    f.append("name", "Louça");
    f.append("rotation", B);
    f.append("rotation", A);
    expect(formToObject(f, ["rotation", "weekdays"])).toEqual({ name: "Louça", rotation: [B, A], weekdays: [] });
  });
});

describe("datas das tarefas", () => {
  it("dia da semana e dias do mês", () => {
    expect(weekdayOf("2026-11-10")).toBe(2); // terça
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
  });
  it("diária: o próprio dia e depois o seguinte, inclusive na virada do ano", () => {
    const s = { frequency: "diaria" as const, weekdays: null, month_day: null };
    expect(firstDueOn(s, "2026-11-10")).toBe("2026-11-10");
    expect(nextDueAfter(s, "2026-12-31")).toBe("2027-01-01");
  });
  it("semanal: próximo dia marcado, atravessando a semana", () => {
    const s = { frequency: "semanal" as const, weekdays: [1, 4], month_day: null }; // seg e qui
    expect(firstDueOn(s, "2026-11-10")).toBe("2026-11-12"); // ter → qui
    expect(nextDueAfter(s, "2026-11-12")).toBe("2026-11-16"); // qui → seg
    expect(firstDueOn(s, "2026-11-16")).toBe("2026-11-16");
    expect(nextDueAfter({ ...s, weekdays: [2] }, "2026-11-10")).toBe("2026-11-17");
  });
  it("mensal: mesmo dia no mês seguinte, com o último dia em meses curtos e sem perder o dia 31", () => {
    const s = { frequency: "mensal" as const, weekdays: null, month_day: 31 };
    expect(firstDueOn(s, "2026-11-10")).toBe("2026-11-30");
    expect(nextDueAfter(s, "2026-11-30")).toBe("2026-12-31");
    expect(nextDueAfter(s, "2027-01-31")).toBe("2027-02-28");
    expect(nextDueAfter(s, "2027-02-28")).toBe("2027-03-31");
    expect(nextDueAfter(s, "2027-12-31")).toBe("2028-01-31");
    expect(firstDueOn({ ...s, month_day: 5 }, "2026-11-10")).toBe("2026-12-05");
    expect(nextDueAfter({ ...s, month_day: 29 }, "2028-01-29")).toBe("2028-02-29");
  });
});

describe("rodízio", () => {
  const valid = new Set([A, B, C]);
  const base = { frequency: "diaria" as const, weekdays: null, month_day: null };
  it("Feita alterna entre duas pessoas (circular) e avança a data", () => {
    let c = { ...base, rotation: [A, B], next_index: 0, next_due_on: "2026-11-10" };
    const r1 = completeChore(c, "2026-11-10", valid);
    expect(r1).toEqual({ member_id: A, done_on: "2026-11-10", next_index: 1, next_due_on: "2026-11-11" });
    c = { ...c, next_index: r1.next_index, next_due_on: r1.next_due_on };
    const r2 = completeChore(c, "2026-11-11", valid);
    expect(r2).toMatchObject({ member_id: B, next_index: 0, next_due_on: "2026-11-12" });
  });
  it("atrasada feita hoje vai para depois de hoje; adiantada segue da data prevista", () => {
    expect(completeChore({ ...base, rotation: [A], next_index: 0, next_due_on: "2026-11-05" }, "2026-11-10", valid).next_due_on).toBe("2026-11-11");
    expect(completeChore({ ...base, rotation: [A], next_index: 0, next_due_on: "2026-11-12" }, "2026-11-10", valid).next_due_on).toBe("2026-11-13");
  });
  it("member apagado no rodízio é pulado ao exibir, ao concluir e ao editar", () => {
    const only = new Set([A, C]); // B saiu da família
    const c = { rotation: [A, B, C], next_index: 1 };
    expect(currentResponsible(c, only)).toBe(C);
    expect(advanceRotation(c, only)).toBe(0); // C fez → volta para A (pula B)
    expect(advanceRotation({ rotation: [A, B, C], next_index: 0 }, only)).toBe(2); // A fez → pula B → C
    const done = completeChore({ ...base, ...c, next_due_on: "2026-11-10" }, "2026-11-10", only);
    expect(done.member_id).toBe(C);
    expect(done.next_index).toBe(0);
    expect(cleanRotation([A, B, C, B], only)).toEqual([A, C]);
  });
  it("sem ninguém válido: responsável null e índice ainda avança dentro do array", () => {
    const none = new Set<string>();
    expect(currentResponsible({ rotation: [A, B], next_index: 0 }, none)).toBeNull();
    expect(advanceRotation({ rotation: [A, B], next_index: 1 }, none)).toBe(0);
    expect(advanceRotation({ rotation: [], next_index: 0 }, none)).toBe(0);
  });
  it("pessoa repetida no rodízio", () => {
    expect(advanceRotation({ rotation: [A, A, B], next_index: 0 }, valid)).toBe(1);
    expect(currentResponsible({ rotation: [A, A, B], next_index: 1 }, valid)).toBe(A);
  });
});

describe("manutenção", () => {
  it("próxima data por unidade", () => {
    expect(nextMaintenanceDue("2026-11-10", 10, "dias")).toBe("2026-11-20");
    expect(nextMaintenanceDue("2026-11-10", 2, "semanas")).toBe("2026-11-24");
    expect(nextMaintenanceDue("2026-08-31", 6, "meses")).toBe("2027-02-28");
    expect(nextMaintenanceDue("2028-02-29", 1, "anos")).toBe("2029-02-28");
    expect(nextMaintenanceDue(null, 1, "anos")).toBeNull();
  });
  it("status: vencida, em breve (15 dias), em dia, sem data", () => {
    expect(maintenanceStatus("2026-11-09", "2026-11-10")).toBe("vencida");
    expect(maintenanceStatus("2026-11-10", "2026-11-10")).toBe("em-breve");
    expect(maintenanceStatus("2026-11-25", "2026-11-10")).toBe("em-breve");
    expect(maintenanceStatus("2026-11-26", "2026-11-10")).toBe("em-dia");
    expect(maintenanceStatus(null, "2026-11-10")).toBe("sem-data");
  });
  it("ordena pela próxima data, sem data por último", () => {
    const l = sortMaintenance([
      { name: "b", next_due_on: null },
      { name: "a", next_due_on: "2026-12-01" },
      { name: "c", next_due_on: "2026-11-01" },
    ]);
    expect(l.map((x) => x.name)).toEqual(["c", "a", "b"]);
  });
  it("valida intervalo, data e custo", () => {
    const today = "2026-11-10";
    expect(validateMaintenanceInput({ name: "Filtro", interval_value: "6", interval_unit: "meses" }, today)).toMatchObject({ ok: true, value: { interval_value: 6, last_done_on: null } });
    expect(validateMaintenanceInput({ name: "Filtro", interval_value: "0", interval_unit: "meses" }, today).ok).toBe(false);
    expect(validateMaintenanceInput({ name: "Filtro", interval_value: "366", interval_unit: "meses" }, today).ok).toBe(false);
    expect(validateMaintenanceInput({ name: "Filtro", interval_value: "1", interval_unit: "horas" }, today).ok).toBe(false);
    expect(validateMaintenanceInput({ name: "Filtro", interval_value: "1", interval_unit: "anos", last_done_on: "2026-11-11" }, today).ok).toBe(false);
    expect(validateMaintenanceDone({}, today)).toEqual({ ok: true, value: { done_on: today, cost: null, notes: null } });
    expect(validateMaintenanceDone({ done_on: "2026-10-01", cost: "1.234,50" }, today)).toMatchObject({ ok: true, value: { done_on: "2026-10-01", cost: 1234.5 } });
    expect(validateMaintenanceDone({ done_on: "2026-11-11" }, today).ok).toBe(false);
    expect(validateMaintenanceDone({ cost: "-5" }, today).ok).toBe(false);
    expect(validateMaintenanceDone({ cost: "abc" }, today).ok).toBe(false);
  });
});

describe("despensa: acabando, vencendo e lista automática", () => {
  it("acabando = quantidade <= mínimo", () => {
    expect(isLow({ quantity: 1, min_quantity: 1 })).toBe(true);
    expect(isLow({ quantity: 2, min_quantity: 1 })).toBe(false);
    expect(isLow({ quantity: 0, min_quantity: 0 })).toBe(true);
  });
  it("vencendo = validade em até 7 dias; vencido = antes de hoje", () => {
    expect(expiryStatus("2026-11-09", "2026-11-10")).toBe("vencido");
    expect(expiryStatus("2026-11-10", "2026-11-10")).toBe("vencendo");
    expect(expiryStatus("2026-11-17", "2026-11-10")).toBe("vencendo");
    expect(expiryStatus("2026-11-18", "2026-11-10")).toBeNull();
    expect(expiryStatus(null, "2026-11-10")).toBeNull();
  });
  it("adiciona ao cair para o mínimo, sem duplicar e nunca ao repor", () => {
    expect(shouldAutoAdd({ before: 2, after: 1, min: 1, hasPending: false })).toBe(true);
    expect(shouldAutoAdd({ before: 2, after: 1, min: 1, hasPending: true })).toBe(false);
    expect(shouldAutoAdd({ before: 3, after: 2, min: 1, hasPending: false })).toBe(false);
    expect(shouldAutoAdd({ before: 0, after: 1, min: 1, hasPending: false })).toBe(false); // subindo
    expect(shouldAutoAdd({ before: null, after: 0, min: 1, hasPending: false })).toBe(true); // novo já acabando
    expect(shouldAutoAdd({ before: 2, after: 2, min: 2, hasPending: false })).toBe(true); // mínimo aumentou na edição
  });
});

describe("auto-adicionar: índice único parcial", () => {
  it("23505 = já está na lista (sucesso silencioso); outros erros falham", () => {
    expect(autoAddOutcome(null)).toBe("added");
    expect(autoAddOutcome(undefined)).toBe("added");
    expect(autoAddOutcome("23505")).toBe("already");
    expect(autoAddOutcome("42501")).toBe("failed");
  });
  it("desmarcar com outro pendente igual (23505): avisa e não desmarca", () => {
    expect(toggleErrorMessage("23505")).toBe("Este item já está na lista.");
    expect(toggleErrorMessage(undefined)).toBe("Não foi possível atualizar.");
  });
});

describe("telas", () => {
  it("agrupa a lista por categoria e separa os comprados", () => {
    const { groups, done } = groupShopping([
      { name: "Sabão", category: "Limpeza", done: false },
      { name: "Arroz", category: "Mercado", done: false },
      { name: "Pão", category: null, done: false },
      { name: "Feijão", category: "Mercado", done: true },
      { name: "Açúcar", category: " Mercado ", done: false },
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Limpeza", "Mercado", "Sem categoria"]);
    expect(groups[1].items.map((i) => i.name)).toEqual(["Açúcar", "Arroz"]);
    expect(done.map((i) => i.name)).toEqual(["Feijão"]);
  });
  it("tarefas em atrasadas, hoje e próximas (só ativas)", () => {
    const b = choreBuckets(
      [
        { id: 1, active: true, next_due_on: "2026-11-12" },
        { id: 2, active: true, next_due_on: "2026-11-10" },
        { id: 3, active: true, next_due_on: "2026-11-01" },
        { id: 4, active: false, next_due_on: "2026-11-01" },
      ],
      "2026-11-10",
    );
    expect([b.overdue, b.today, b.upcoming].map((l) => l.map((c) => c.id))).toEqual([[3], [2], [1]]);
  });
  it("rótulos", () => {
    expect(qtyLabel(1.5, "kg")).toBe("1,5 kg");
    expect(qtyLabel(null, null)).toBe("");
    expect(frequencyLabel({ frequency: "semanal", weekdays: [4, 1], month_day: null })).toBe("Semanal: seg, qui");
    expect(frequencyLabel({ frequency: "mensal", weekdays: null, month_day: 31 })).toBe("Mensal: dia 31 (ou o último dia do mês)");
    expect(intervalLabel(1, "meses")).toBe("A cada mês");
    expect(intervalLabel(6, "meses")).toBe("A cada 6 meses");
  });
});
