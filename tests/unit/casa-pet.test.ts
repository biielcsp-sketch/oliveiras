import { describe, expect, it } from "vitest";
import { brDate } from "@/lib/agenda/dates";
import {
  completeCareWith,
  currentHealth,
  currentHealthIds,
  doseAlerts,
  doseStatus,
  doseWhen,
  foodForecast,
  foodShoppingName,
  groupHealth,
  isPetFileKind,
  nextCareDue,
  nextDose,
  overdueCare,
  petAge,
  petFileHref,
  petSummary,
  pickPet,
  STALE_CARE,
  weightHistory,
  type CareExpected,
  type CareRepo,
  type CareState,
} from "@/lib/casa/pet";
import {
  parseCareExpected,
  validatePetCareDone,
  validatePetCareInput,
  validatePetFoodInput,
  validatePetHealthInput,
  validatePetInput,
  validatePetVetInput,
  validatePetWeightInput,
} from "@/lib/casa/pet-input";
import { casaDocPath, casaFilePath, isCasaDocPath, isCasaFilePath, isCasaPetPath } from "@/lib/casa/docs";
import { ingredientsToAdd } from "@/lib/casa/menu";
import { CASA_TABS } from "@/lib/casa/nav";
import { activeRouteIndex } from "@/lib/arc-nav";

const HH = "11111111-1111-4111-8111-111111111111";
const PET = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-11-11";

describe("menu da Casa com a aba Pet", () => {
  it("Pet fica logo depois de Compras (lugar da Despensa) e o Resumo continua com abas dos dois lados", () => {
    expect(CASA_TABS.map((t) => t.key).slice(0, 2)).toEqual(["compras", "pet"]);
    expect(CASA_TABS[activeRouteIndex(CASA_TABS, "/casa/pet")].key).toBe("pet");
    const i = activeRouteIndex(CASA_TABS, "/casa");
    expect(CASA_TABS[i].key).toBe("resumo");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(CASA_TABS.length - 1);
    expect(new Set(CASA_TABS.map((t) => t.href)).size).toBe(CASA_TABS.length);
  });
});

describe("cadastro do pet", () => {
  it("valida nome, espécie, sexo, nascimento (não no futuro) e tamanhos", () => {
    expect(validatePetInput({ name: "  Moisés ", species: "cachorro", sex: "macho", birth_date: "2022-03-01", breed: " Vira-lata " }, TODAY)).toEqual({
      ok: true,
      value: { name: "Moisés", species: "cachorro", breed: "Vira-lata", sex: "macho", birth_date: "2022-03-01", notes: null },
    });
    expect(validatePetInput({ name: "", species: "cachorro" }, TODAY).ok).toBe(false);
    expect(validatePetInput({ name: "x".repeat(61), species: "cachorro" }, TODAY).ok).toBe(false);
    expect(validatePetInput({ name: "Rex", species: "peixe" }, TODAY).ok).toBe(false);
    expect(validatePetInput({ name: "Rex", species: "gato", sex: "outro" }, TODAY).ok).toBe(false);
    expect(validatePetInput({ name: "Rex", species: "gato", birth_date: "2026-11-12" }, TODAY).ok).toBe(false);
    expect(validatePetInput({ name: "Rex", species: "gato", birth_date: "2026-02-30" }, TODAY).ok).toBe(false);
    expect(validatePetInput({ name: "Rex", species: "outro", notes: "x".repeat(501) }, TODAY).ok).toBe(false);
    expect(validatePetInput({ name: "Rex", species: "outro", sex: "" }, TODAY)).toMatchObject({ ok: true, value: { sex: null } });
  });

  it("idade a partir do nascimento", () => {
    expect(petAge("2022-03-01", TODAY)).toBe("4 anos e 8 meses");
    expect(petAge("2025-11-11", TODAY)).toBe("1 ano");
    expect(petAge("2025-11-12", TODAY)).toBe("11 meses");
    expect(petAge("2026-10-20", TODAY)).toBe("menos de 1 mês");
    expect(petAge(null, TODAY)).toBeNull();
    expect(petAge("2027-01-01", TODAY)).toBeNull();
  });

  it("um pet abre direto; com mais, o pedido na URL (se for da família) ou o primeiro em ordem alfabética", () => {
    const moises = { id: PET, name: "Moisés" };
    const bela = { id: ID, name: "Bela" };
    expect(pickPet([moises], undefined)).toBe(moises);
    expect(pickPet([moises, bela], undefined)).toBe(bela);
    expect(pickPet([moises, bela], PET.toUpperCase())).toBe(moises);
    expect(pickPet([moises, bela], "44444444-4444-4444-8444-444444444444")).toBe(bela);
    expect(pickPet([], PET)).toBeNull();
  });
});

describe("vacinas e remédios", () => {
  it("valida pet (uuid), tipo, nome, dose e próxima dose >= aplicação", () => {
    expect(validatePetHealthInput({ pet_id: PET, kind: "vacina", name: " V10 ", dose: "1ª dose", applied_on: "2026-11-01", next_due_on: "2026-11-22" })).toEqual({
      ok: true,
      value: { pet_id: PET, kind: "vacina", name: "V10", dose: "1ª dose", applied_on: "2026-11-01", next_due_on: "2026-11-22", notes: null },
    });
    expect(validatePetHealthInput({ pet_id: "1; drop", kind: "vacina", name: "V10" }).ok).toBe(false);
    expect(validatePetHealthInput({ pet_id: PET, kind: "banho", name: "V10" }).ok).toBe(false);
    expect(validatePetHealthInput({ pet_id: PET, kind: "remedio", name: "" }).ok).toBe(false);
    expect(validatePetHealthInput({ pet_id: PET, kind: "remedio", name: "x".repeat(121) }).ok).toBe(false);
    expect(validatePetHealthInput({ pet_id: PET, kind: "remedio", name: "A", dose: "x".repeat(61) }).ok).toBe(false);
    expect(validatePetHealthInput({ pet_id: PET, kind: "vacina", name: "V10", applied_on: "2026-11-10", next_due_on: "2026-11-09" })).toEqual({
      ok: false,
      erro: "A próxima dose não pode ser antes da aplicação.",
    });
    expect(validatePetHealthInput({ pet_id: PET, kind: "vacina", name: "V10", next_due_on: "2026-13-01" }).ok).toBe(false);
  });

  it("status da próxima dose: atrasada, hoje, em até 7 dias, em dia", () => {
    expect(doseStatus("2026-11-10", TODAY)).toBe("atrasada");
    expect(doseStatus(TODAY, TODAY)).toBe("hoje");
    expect(doseStatus("2026-11-12", TODAY)).toBe("em-breve");
    expect(doseStatus("2026-11-18", TODAY)).toBe("em-breve");
    expect(doseStatus("2026-11-19", TODAY)).toBe("em-dia");
    expect(doseStatus(null, TODAY)).toBeNull();
    expect(doseWhen("2026-11-08", TODAY, brDate)).toBe("atrasada há 3 dias");
    expect(doseWhen("2026-11-10", TODAY, brDate)).toBe("atrasada há 1 dia");
    expect(doseWhen(TODAY, TODAY, brDate)).toBe("hoje");
    expect(doseWhen("2026-11-12", TODAY, brDate)).toBe("amanhã");
    expect(doseWhen("2026-11-16", TODAY, brDate)).toBe("em 5 dias");
    expect(doseWhen("2027-11-11", TODAY, brDate)).toBe("em 11/11/2027");
  });

  it("destaque só com atrasadas, hoje e próximos 7 dias, da mais antiga para a mais nova; próxima dose inclui as distantes", () => {
    const items = [
      { name: "Antirrábica", next_due_on: "2027-03-01" },
      { name: "V10", next_due_on: "2026-11-15" },
      { name: "Bravecto", next_due_on: "2026-11-01" },
      { name: "Drontal", next_due_on: null },
      { name: "Gripe", next_due_on: TODAY },
    ];
    expect(doseAlerts(items, TODAY).map((i) => i.name)).toEqual(["Bravecto", "Gripe", "V10"]);
    expect(nextDose(items)?.name).toBe("Bravecto");
    expect(nextDose([{ name: "x", next_due_on: null }])).toBeNull();
  });

  it("agrupa por tipo na ordem fixa; dentro do tipo, próxima dose primeiro", () => {
    const g = groupHealth([
      { id: "1", kind: "remedio" as const, name: "Apoquel", next_due_on: null, applied_on: "2026-10-01" },
      { id: "2", kind: "vacina" as const, name: "Antirrábica", next_due_on: "2027-01-01", applied_on: null },
      { id: "3", kind: "vacina" as const, name: "V10", next_due_on: "2026-12-01", applied_on: null },
      { id: "4", kind: "vacina" as const, name: "Gripe", next_due_on: null, applied_on: "2026-01-01" },
    ]);
    expect(g.map((x) => x.kind)).toEqual(["vacina", "remedio"]);
    expect(g[0].items.map((i) => i.name)).toEqual(["V10", "Antirrábica", "Gripe"]);
  });
});

describe("dose mais recente de cada vacina/remédio", () => {
  const rec = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    pet_id: PET,
    kind: "vacina",
    name: "V10",
    applied_on: null as string | null,
    next_due_on: null as string | null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("dose nova da mesma vacina (nome sem acento/maiúscula) torna a antiga histórico: some o 'atrasada'", () => {
    const old = rec("a", { name: "Antirrábica", applied_on: "2025-11-01", next_due_on: "2026-11-01" });
    const fresh = rec("b", { name: " ANTIRRABICA ", applied_on: TODAY, next_due_on: "2027-11-11", created_at: "2026-11-11T12:00:00Z" });
    expect([...currentHealthIds([old, fresh])]).toEqual(["b"]);
    expect(doseAlerts(currentHealth([old, fresh]), TODAY)).toEqual([]);
    expect(doseAlerts([old], TODAY).map((h) => h.id)).toEqual(["a"]);
  });

  it("ordem: aplicação desc (sem data por último), depois criação desc; grupos por pet e tipo", () => {
    const a = rec("a", { applied_on: "2026-10-01", created_at: "2026-10-01T00:00:00Z" });
    const b = rec("b", { applied_on: null, created_at: "2026-11-10T00:00:00Z" });
    expect([...currentHealthIds([a, b])]).toEqual(["a"]);
    const c = rec("c", { applied_on: "2026-10-01", created_at: "2026-10-02T00:00:00Z" });
    expect([...currentHealthIds([a, c])]).toEqual(["c"]);
    const d = rec("d", { applied_on: null, created_at: "2026-11-11T00:00:00Z" });
    expect([...currentHealthIds([b, d])]).toEqual(["d"]);
    const otherKind = rec("e", { kind: "remedio" });
    const otherPet = rec("f", { pet_id: ID });
    expect(currentHealthIds([a, otherKind, otherPet])).toEqual(new Set(["a", "e", "f"]));
  });

  it("lista: vigentes antes do histórico; Resumo ignora a dose substituída", () => {
    const old = rec("a", { applied_on: "2025-11-01", next_due_on: "2026-11-01" });
    const fresh = rec("b", { applied_on: TODAY, next_due_on: "2027-11-11", created_at: "2026-11-11T12:00:00Z" });
    const g = groupHealth([old, fresh].map((h) => ({ ...h, kind: "vacina" as const })), currentHealthIds([old, fresh]));
    expect(g[0].items.map((i) => i.id)).toEqual(["b", "a"]);
    const lines = petSummary(
      { pets: [{ id: PET, name: "Moisés" }], health: [old, fresh].map((h) => ({ ...h, kind: "vacina" as const, dose: null })), care: [], food: [] },
      TODAY,
      brDate,
    );
    expect(lines[0]).toBe("Próxima dose: Vacina V10 (em 11/11/2027)");
  });
});

describe("veterinário", () => {
  it("data obrigatória, tipo, custo em reais (>= 0) e tamanhos", () => {
    expect(validatePetVetInput({ pet_id: PET, kind: "consulta", happened_on: "2026-11-05", clinic: "Clínica Pet", cost: "180,00", reason: "Check-up" })).toEqual({
      ok: true,
      value: { pet_id: PET, kind: "consulta", happened_on: "2026-11-05", clinic: "Clínica Pet", vet: null, reason: "Check-up", notes: null, cost: 180 },
    });
    expect(validatePetVetInput({ pet_id: PET, kind: "consulta", happened_on: "" }).ok).toBe(false);
    expect(validatePetVetInput({ pet_id: PET, kind: "cirurgia", happened_on: "2026-11-05" }).ok).toBe(false);
    expect(validatePetVetInput({ pet_id: PET, kind: "exame", happened_on: "2026-11-05", cost: "-10" }).ok).toBe(false);
    expect(validatePetVetInput({ pet_id: PET, kind: "exame", happened_on: "2026-11-05", cost: "abc" }).ok).toBe(false);
    expect(validatePetVetInput({ pet_id: PET, kind: "exame", happened_on: "2026-11-05", reason: "x".repeat(201) }).ok).toBe(false);
    expect(validatePetVetInput({ pet_id: PET, kind: "receita", happened_on: "2026-11-05", notes: "x".repeat(2001) }).ok).toBe(false);
  });
});

describe("cuidados recorrentes", () => {
  it("valida intervalo (1 a 365; dias, semanas ou meses), última vez (não no futuro) e prestador (uuid)", () => {
    expect(validatePetCareInput({ pet_id: PET, name: "Banho", interval_value: "15", interval_unit: "dias", provider_id: ID.toUpperCase() }, TODAY)).toEqual({
      ok: true,
      value: { pet_id: PET, name: "Banho", interval_value: 15, interval_unit: "dias", last_done_on: null, provider_id: ID, notes: null },
    });
    expect(validatePetCareInput({ pet_id: PET, name: "Banho", interval_value: "0", interval_unit: "dias" }, TODAY).ok).toBe(false);
    expect(validatePetCareInput({ pet_id: PET, name: "Banho", interval_value: "366", interval_unit: "dias" }, TODAY).ok).toBe(false);
    expect(validatePetCareInput({ pet_id: PET, name: "Banho", interval_value: "1", interval_unit: "anos" }, TODAY).ok).toBe(false);
    expect(validatePetCareInput({ pet_id: PET, name: "Banho", interval_value: "1", interval_unit: "dias", last_done_on: "2026-11-12" }, TODAY).ok).toBe(false);
    expect(validatePetCareInput({ pet_id: PET, name: "Banho", interval_value: "1", interval_unit: "dias", provider_id: "abc" }, TODAY).ok).toBe(false);
    expect(validatePetCareDone({ done_on: "", cost: "70,00" }, TODAY)).toEqual({ ok: true, value: { done_on: TODAY, cost: 70, notes: null } });
    expect(validatePetCareDone({ done_on: "2026-11-12" }, TODAY).ok).toBe(false);
    expect(parseCareExpected({ expected_last: "", expected_next: "2026-11-20" })).toEqual({ last_done_on: null, next_due_on: "2026-11-20" });
    expect(parseCareExpected({ expected_last: "ontem" })).toBeNull();
  });

  it("próxima data com a conta da Manutenção (mês curto cai no último dia) e vencidos", () => {
    expect(nextCareDue("2026-11-01", 15, "dias")).toBe("2026-11-16");
    expect(nextCareDue("2026-11-01", 2, "semanas")).toBe("2026-11-15");
    expect(nextCareDue("2026-01-31", 1, "meses")).toBe("2026-02-28");
    expect(nextCareDue(null, 1, "meses")).toBeNull();
    expect(overdueCare([{ active: true, next_due_on: "2026-11-10" }, { active: true, next_due_on: TODAY }, { active: false, next_due_on: "2026-01-01" }, { active: true, next_due_on: null }], TODAY)).toHaveLength(1);
  });

  /** Fake em memória com a mesma semântica do update condicional do Supabase. */
  function careStore(init: Partial<CareState> = {}) {
    const care: CareState = { id: "c", interval_value: 15, interval_unit: "dias", last_done_on: "2026-11-01", next_due_on: "2026-11-16", ...init };
    const logs: { done_on: string; cost: number | null }[] = [];
    let failLog = false;
    const tick = () => new Promise<void>((r) => setTimeout(r, 0));
    const same = (e: CareExpected) => care.last_done_on === e.last_done_on && care.next_due_on === e.next_due_on;
    const repo: CareRepo = {
      async read() {
        const snap = { ...care };
        await tick();
        return snap;
      },
      async updateIf(e, patch) {
        await tick();
        if (!same(e)) return false;
        Object.assign(care, patch);
        return true;
      },
      async insertLog(row) {
        if (failLog) return false;
        logs.push(row);
        return true;
      },
    };
    return { care, logs, repo, failLogs: () => (failLog = true) };
  }
  const shown = { last_done_on: "2026-11-01", next_due_on: "2026-11-16" };

  it("'Feito' grava o histórico e recalcula a próxima data a partir da data feita", async () => {
    const s = careStore();
    expect(await completeCareWith(s.repo, shown, { done_on: TODAY, cost: 70, notes: null })).toEqual({ ok: true });
    expect(s.care).toMatchObject({ last_done_on: TODAY, next_due_on: "2026-11-26" });
    expect(s.logs).toEqual([{ done_on: TODAY, cost: 70, notes: null }]);
  });

  it("data antiga registrada depois não faz a última vez voltar no tempo", async () => {
    const s = careStore();
    await completeCareWith(s.repo, shown, { done_on: "2026-10-20", cost: null, notes: null });
    expect(s.care).toMatchObject({ last_done_on: "2026-11-01", next_due_on: "2026-11-16" });
    expect(s.logs).toHaveLength(1);
  });

  it("dois aparelhos ao mesmo tempo: só um registra; o outro recebe aviso, sem histórico duplicado", async () => {
    const s = careStore();
    const [a, b] = await Promise.all([
      completeCareWith(s.repo, shown, { done_on: TODAY, cost: null, notes: null }),
      completeCareWith(s.repo, shown, { done_on: TODAY, cost: null, notes: null }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, erro: STALE_CARE });
    expect(s.logs).toHaveLength(1);
  });

  it("tela desatualizada não registra; histórico que falha desfaz a atualização", async () => {
    const s = careStore();
    expect(await completeCareWith(s.repo, { last_done_on: null, next_due_on: null }, { done_on: TODAY, cost: null, notes: null })).toEqual({ ok: false, erro: STALE_CARE });
    s.failLogs();
    const r = await completeCareWith(s.repo, shown, { done_on: TODAY, cost: null, notes: null });
    expect(r.ok).toBe(false);
    expect(s.care).toMatchObject(shown);
  });
});

describe("peso", () => {
  it("valida peso (0 < x < 200, até 2 casas, vírgula ou ponto) e data (padrão hoje, não no futuro)", () => {
    expect(validatePetWeightInput({ pet_id: PET, weight_kg: "12,5" }, TODAY)).toEqual({ ok: true, value: { pet_id: PET, measured_on: TODAY, weight_kg: 12.5 } });
    expect(validatePetWeightInput({ pet_id: PET, weight_kg: "0" }, TODAY).ok).toBe(false);
    expect(validatePetWeightInput({ pet_id: PET, weight_kg: "200" }, TODAY).ok).toBe(false);
    expect(validatePetWeightInput({ pet_id: PET, weight_kg: "12.345" }, TODAY).ok).toBe(false);
    expect(validatePetWeightInput({ pet_id: PET, weight_kg: "" }, TODAY).ok).toBe(false);
    expect(validatePetWeightInput({ pet_id: PET, weight_kg: "12", measured_on: "2026-11-12" }, TODAY).ok).toBe(false);
  });

  it("histórico do mais recente ao mais antigo com variação (sem erro de ponto flutuante)", () => {
    const h = weightHistory([
      { measured_on: "2026-10-01", weight_kg: 12.1 },
      { measured_on: "2026-11-01", weight_kg: 12.3 },
      { measured_on: "2026-10-15", weight_kg: 12.6 },
    ]);
    expect(h.map((w) => [w.measured_on, w.delta])).toEqual([
      ["2026-11-01", -0.3],
      ["2026-10-15", 0.5],
      ["2026-10-01", null],
    ]);
  });
});

describe("ração", () => {
  it("valida marca, saco (0 < kg <= 100), gramas por dia (1 a 5000, opcional) e início", () => {
    expect(validatePetFoodInput({ pet_id: PET, brand: "Premier", bag_kg: "15", daily_grams: "300", started_on: "2026-11-01" }, TODAY)).toEqual({
      ok: true,
      value: { pet_id: PET, brand: "Premier", bag_kg: 15, daily_grams: 300, started_on: "2026-11-01", notes: null },
    });
    expect(validatePetFoodInput({ pet_id: PET, brand: "Premier", bag_kg: "10,1" }, TODAY)).toMatchObject({ ok: true, value: { bag_kg: 10.1, daily_grams: null, started_on: TODAY } });
    expect(validatePetFoodInput({ pet_id: PET, brand: "", bag_kg: "15" }, TODAY).ok).toBe(false);
    expect(validatePetFoodInput({ pet_id: PET, brand: "P", bag_kg: "0" }, TODAY).ok).toBe(false);
    expect(validatePetFoodInput({ pet_id: PET, brand: "P", bag_kg: "100.01" }, TODAY).ok).toBe(false);
    expect(validatePetFoodInput({ pet_id: PET, brand: "P", bag_kg: "15", daily_grams: "0" }, TODAY).ok).toBe(false);
    expect(validatePetFoodInput({ pet_id: PET, brand: "P", bag_kg: "15", daily_grams: "5001" }, TODAY).ok).toBe(false);
    expect(validatePetFoodInput({ pet_id: PET, brand: "P", bag_kg: "15", daily_grams: "2,5" }, TODAY).ok).toBe(false);
  });

  it("previsão: kg × 1000 ÷ g/dia a partir do início; destaque com 5 dias ou menos; sem g/dia não há previsão", () => {
    expect(foodForecast({ bag_kg: 15, daily_grams: 300, started_on: "2026-11-01" }, TODAY)).toEqual({ days: 50, endsOn: "2026-12-21", daysLeft: 40, low: false });
    expect(foodForecast({ bag_kg: 3, daily_grams: 200, started_on: "2026-11-01" }, TODAY)).toMatchObject({ days: 15, endsOn: "2026-11-16", daysLeft: 5, low: true });
    expect(foodForecast({ bag_kg: 3, daily_grams: 200, started_on: "2026-11-02" }, TODAY)).toMatchObject({ daysLeft: 6, low: false });
    expect(foodForecast({ bag_kg: 1, daily_grams: 200, started_on: "2026-11-01" }, TODAY)).toMatchObject({ daysLeft: -5, low: true });
    expect(foodForecast({ bag_kg: 1.15, daily_grams: 115, started_on: TODAY }, TODAY)).toMatchObject({ days: 10 });
    expect(foodForecast({ bag_kg: 15, daily_grams: null, started_on: "2026-11-01" }, TODAY)).toBeNull();
  });

  it("nome na lista de compras e sem duplicar pendente com o mesmo nome (sem acento/maiúscula)", () => {
    expect(foodShoppingName("  Premier   Adulto ")).toBe("Ração Premier Adulto");
    expect(foodShoppingName("x".repeat(120)).length).toBe(120);
    expect(ingredientsToAdd([foodShoppingName("Premier")], ["racao premier"]).add).toEqual([]);
    expect(ingredientsToAdd([foodShoppingName("Premier")], ["Arroz"]).add).toEqual(["Ração Premier"]);
  });
});

describe("arquivos do Pet", () => {
  it("caminho em {household}/pets/{uuid}.{pdf|jpg}; documentos continuam só em docs/", () => {
    expect(casaFilePath(HH, "pets", ID, "jpg")).toBe(`${HH}/pets/${ID}.jpg`);
    expect(casaFilePath(HH, "docs", ID, "pdf")).toBe(casaDocPath(HH, ID, "pdf"));
    expect(isCasaPetPath(`${HH}/pets/${ID}.pdf`)).toBe(true);
    expect(isCasaPetPath(`${HH}/docs/${ID}.pdf`)).toBe(false);
    expect(isCasaPetPath(`${HH}/pets/../${ID}.pdf`)).toBe(false);
    expect(isCasaPetPath(`${HH}/pets/${ID}.html`)).toBe(false);
    expect(isCasaDocPath(`${HH}/pets/${ID}.pdf`)).toBe(false);
    expect(isCasaFilePath(`${HH}/pets/${ID}.pdf`, "docs")).toBe(false);
    expect(isCasaFilePath(`${HH}/pets/${ID}.pdf`, "pets")).toBe(true);
  });

  it("rota de arquivo só com tipos da lista fechada", () => {
    expect(isPetFileKind("saude")).toBe(true);
    expect(isPetFileKind("veterinario")).toBe(true);
    expect(isPetFileKind("casa_documents")).toBe(false);
    expect(isPetFileKind("constructor")).toBe(false);
    expect(petFileHref("saude", ID)).toBe(`/casa/pet/arquivo/saude/${ID}`);
  });
});

describe("card do Pet no Resumo", () => {
  const base = { pets: [{ id: PET, name: "Moisés" }], health: [], care: [], food: [] };
  it("sem pets: convite", () => {
    expect(petSummary({ pets: [], health: [], care: [], food: [] }, TODAY, brDate)).toEqual(["Nenhum pet cadastrado."]);
  });
  it("próxima dose, cuidados vencidos e ração acabando", () => {
    expect(
      petSummary(
        {
          ...base,
          health: [
            { id: "h1", pet_id: PET, kind: "vacina", name: "V10", dose: "Reforço", applied_on: "2025-11-12", next_due_on: "2026-11-12", created_at: "2025-11-12T12:00:00Z" },
            { id: "h2", pet_id: PET, kind: "antipulgas", name: "Bravecto", dose: null, applied_on: null, next_due_on: "2027-01-01", created_at: "2026-10-01T12:00:00Z" },
          ],
          care: [{ active: true, next_due_on: "2026-11-01" }],
          food: [{ pet_id: PET, bag_kg: 3, daily_grams: 200, started_on: "2026-11-01" }],
        },
        TODAY,
        brDate,
      ),
    ).toEqual(["Próxima dose: Vacina V10 - Reforço (amanhã)", "1 cuidado vencido", "Ração acabando"]);
    expect(petSummary(base, TODAY, brDate)).toEqual(["Nenhuma dose agendada.", "0 cuidados vencidos"]);
  });
  it("com mais de um pet, mostra de quem é", () => {
    const pets = [...base.pets, { id: ID, name: "Bela" }];
    expect(
      petSummary(
        { pets, health: [{ id: "h3", pet_id: ID, kind: "vermifugo", name: "Drontal", dose: null, applied_on: null, next_due_on: "2026-11-09", created_at: "2026-08-01T12:00:00Z" }], care: [], food: [{ pet_id: ID, bag_kg: 1, daily_grams: 200, started_on: "2026-11-01" }] },
        TODAY,
        brDate,
      ),
    ).toEqual(["Próxima dose: Bela: Vermífugo Drontal (atrasada há 2 dias)", "0 cuidados vencidos", "Ração acabando: Bela"]);
  });
});
