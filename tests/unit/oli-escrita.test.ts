import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  argsDaAba,
  flatArgs,
  NAO_E_SEU,
  parseAlterarArgs,
  planAlteracao,
  planToFormEntries,
  previewFingerprint,
  type AlterarAba,
  type AlterarLookup,
  type Row,
} from "@/lib/oli/alterar";
import { ALTERAR_TOOLS, OLI_PERSONA } from "@/lib/oli/prompt";
import { OliPanels } from "@/components/oli/oli-panels";
import type { OliPanel } from "@/lib/oli/panels";

vi.mock("server-only", () => ({}));

/* Actions das telas simuladas: o teste confere que a gravação do Oli passa por elas. */
const calls = vi.hoisted(() => ({ list: [] as { fn: string; arg: unknown }[] }));
const save = (fn: string) => async (_: unknown, fd: FormData) => {
  calls.list.push({ fn, arg: [...fd.entries()] });
  return { ok: true };
};
const del = (fn: string) => async (id: string) => {
  calls.list.push({ fn, arg: id });
  return { ok: true };
};
vi.mock("@/app/(app)/casa/actions", () => ({
  saveChore: save("saveChore"),
  saveShoppingItem: save("saveShoppingItem"),
  saveMaintenance: save("saveMaintenance"),
  deleteChore: del("deleteChore"),
  deleteShoppingItem: del("deleteShoppingItem"),
  deleteMaintenance: del("deleteMaintenance"),
  completeChore: async (id: string, exp: unknown) => {
    calls.list.push({ fn: "completeChore", arg: [id, exp] });
    return { ok: true };
  },
}));
vi.mock("@/app/(app)/casa/documentos-actions", () => ({ saveCasaDocument: save("saveCasaDocument"), deleteCasaDocument: del("deleteCasaDocument") }));
vi.mock("@/app/(app)/casa/cardapio-actions", () => ({ saveMeal: save("saveMeal"), deleteMeal: del("deleteMeal") }));
vi.mock("@/app/(app)/casa/prestadores-actions", () => ({ saveProvider: save("saveProvider"), deleteProvider: del("deleteProvider") }));
vi.mock("@/app/(app)/casa/pet-actions", () => ({
  savePetHealth: save("savePetHealth"),
  savePetVet: save("savePetVet"),
  savePetCare: save("savePetCare"),
  savePetWeight: save("savePetWeight"),
  savePetFood: save("savePetFood"),
  deletePetHealth: del("deletePetHealth"),
  deletePetVet: del("deletePetVet"),
  deletePetCare: del("deletePetCare"),
  deletePetWeight: del("deletePetWeight"),
  deletePetFood: del("deletePetFood"),
}));
vi.mock("@/app/(app)/ministerio/devocional-actions", () => ({
  saveWord: save("saveWord"),
  savePrayer: save("savePrayer"),
  savePurpose: save("savePurpose"),
  deleteWord: del("deleteWord"),
  deletePrayer: del("deletePrayer"),
  deletePurpose: del("deletePurpose"),
}));
vi.mock("@/app/(app)/ministerio/carisma-actions", () => ({ saveLesson: save("saveLesson"), deleteLesson: del("deleteLesson") }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = { id: U(1), name: "Gabriel", user_id: U(101) };
const KAREN = { id: U(2), name: "Karen", user_id: U(102) };
const LK: AlterarLookup = { uid: ME.user_id, me: ME, members: [ME, KAREN], pets: [{ id: U(50), name: "Moisés" }], today: "2026-11-13" };

function plan(aba: AlterarAba, args: Record<string, unknown>, row: Row | null = null, lk = LK) {
  const a = parseAlterarArgs(aba, args);
  if (!a.ok) return a;
  return planAlteracao(a.value, row, lk);
}
function okPlan(aba: AlterarAba, args: Record<string, unknown>, row: Row | null = null, lk = LK) {
  const r = plan(aba, args, row, lk);
  if (!r.ok) throw new Error(r.erro);
  return r.plan;
}

describe("Oli escrita: argumentos por seção", () => {
  it("ação, seção, id e campos conhecidos", () => {
    expect(parseAlterarArgs("casa", { acao: "sumir", secao: "tarefas" })).toMatchObject({ ok: false, erro: expect.stringContaining("Ação inválida") });
    expect(parseAlterarArgs("casa", { acao: "criar", secao: "garagem" })).toMatchObject({ ok: false, erro: expect.stringContaining("Seção inválida") });
    expect(parseAlterarArgs("financas", { acao: "criar", secao: "tarefas" })).toEqual({ ok: false, erro: "Aba inválida." });
    expect(parseAlterarArgs("casa", { acao: "editar", secao: "tarefas", nome: "x" })).toMatchObject({ ok: false, erro: expect.stringContaining("id do item") });
    expect(parseAlterarArgs("casa", { acao: "criar", secao: "tarefas", id: U(9), nome: "x" })).toEqual({ ok: false, erro: "Para criar não use id." });
    expect(parseAlterarArgs("casa", { acao: "criar", secao: "compras", nome: "Leite", rodizio: ["Karen"] })).toMatchObject({ ok: false, erro: expect.stringContaining("Campo rodizio não existe em compras") });
    expect(parseAlterarArgs("casa", { acao: "editar", secao: "compras", id: U(9) })).toEqual({ ok: false, erro: "Diga o que mudar." });
    expect(parseAlterarArgs("casa", { acao: "apagar", secao: "compras", id: U(9), nome: "Leite" })).toMatchObject({ ok: false });
    expect(parseAlterarArgs("casa", { acao: "concluir", secao: "compras", id: U(9) })).toMatchObject({ ok: false, erro: expect.stringContaining("Em compras dá para") });
    expect(parseAlterarArgs("pet", { acao: "editar", secao: "peso", id: U(9), peso_kg: 10 })).toMatchObject({ ok: false });
    expect(parseAlterarArgs("igreja", { acao: "acrescentar", secao: "carisma", id: U(9) })).toEqual({ ok: false, erro: "Informe a frase a acrescentar." });
    expect(parseAlterarArgs("igreja", { acao: "acrescentar", secao: "carisma", id: U(9), frase: "x".repeat(2001) })).toMatchObject({ ok: false, erro: expect.stringContaining("muito longa") });
    expect(parseAlterarArgs("casa", { acao: "criar", secao: "compras", nome: { evil: 1 } })).toEqual({ ok: false, erro: "Campo nome inválido." });
  });

  it("normaliza ação/seção e é idempotente (os args do painel voltam no Confirmar)", () => {
    const a = parseAlterarArgs("casa", { acao: "Editar", secao: "Manutenção", id: U(9).toUpperCase(), nome: "Filtro", vazio: "" });
    expect(a).toEqual({ ok: true, value: { aba: "casa", acao: "editar", secao: "manutencao", id: U(9), frase: null, valores: { nome: "Filtro" } } });
    if (!a.ok) return;
    expect(parseAlterarArgs("casa", flatArgs(a.value))).toEqual(a);
  });

  it("os campos declarados ao modelo são exatamente os aceitos por aba; persona tem as regras curtas", () => {
    for (const [name, aba] of [["alterar_casa", "casa"], ["alterar_pet", "pet"], ["alterar_igreja", "igreja"]] as const) {
      const tool = ALTERAR_TOOLS.find((t) => t.name === name)!;
      const props = Object.keys(tool.parameters.properties).filter((k) => !["acao", "secao", "id", "frase"].includes(k));
      expect(props.sort()).toEqual(argsDaAba(aba).sort());
    }
    expect(OLI_PERSONA).toContain("nada é gravado sem o toque em Confirmar");
    expect(OLI_PERSONA).toContain("Apagar só quando o usuário pedir claramente");
    expect(OLI_PERSONA).toContain("mais de um item parecido");
    expect(OLI_PERSONA).toContain("compartilhado pelo cônjuge não");
  });
});

describe("Oli escrita: plano e painel (mesmos validadores das telas)", () => {
  it("criar tarefa: rodízio padrão é o usuário; frequência obrigatória como na tela", () => {
    expect(plan("casa", { acao: "criar", secao: "tarefas", nome: "Lavar louça" })).toEqual({ ok: false, erro: "Escolha a frequência." });
    const p = okPlan("casa", { acao: "criar", secao: "tarefas", nome: "Regar plantas", frequencia: "Semanal", dias_semana: ["segunda", "quinta-feira"] });
    expect(p.raw).toMatchObject({ name: "Regar plantas", frequency: "semanal", weekdays: ["1", "4"], rotation: [ME.id] });
    expect(p.preview.campos).toEqual([
      { rotulo: "Tarefa", antes: null, depois: "Regar plantas" },
      { rotulo: "Frequência", antes: null, depois: "Semanal" },
      { rotulo: "Dias da semana", antes: null, depois: "Segunda, Quinta" },
      { rotulo: "Rodízio", antes: null, depois: "Gabriel" },
    ]);
    expect(plan("casa", { acao: "criar", secao: "tarefas", nome: "x", frequencia: "diaria", rodizio: ["Fulano"] })).toMatchObject({ ok: false, erro: expect.stringContaining("Pessoa não encontrada") });
    const r = okPlan("casa", { acao: "criar", secao: "tarefas", nome: "x", frequencia: "diaria", rodizio: "Karen e eu" });
    expect(r.raw.rotation).toEqual([KAREN.id, ME.id]);
  });

  it("editar mostra só o que muda (antes → depois) e mantém o resto da linha", () => {
    const row = { id: U(9), name: "Leite", quantity: 2, unit: "L", category: "Laticínios", notes: null };
    const p = okPlan("casa", { acao: "editar", secao: "compras", id: U(9), quantidade: 3 }, row);
    expect(p.preview.campos).toEqual([{ rotulo: "Quantidade", antes: "2", depois: "3" }]);
    expect(p.raw).toEqual({ name: "Leite", quantity: "3", unit: "L", category: "Laticínios", notes: "" });
    expect(plan("casa", { acao: "editar", secao: "compras", id: U(9), quantidade: 2 }, row)).toEqual({ ok: false, erro: "Nada muda: os valores já são esses." });
    expect(plan("casa", { acao: "editar", secao: "compras", id: U(9), nome: "x".repeat(121) }, row)).toEqual({ ok: false, erro: "Item muito longo (máximo 120)." });
    expect(plan("casa", { acao: "editar", secao: "compras", id: U(9), nome: "Pão" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("não encontrad") });
  });

  it("cardápio: dia e refeição não mudam na edição (a tela grava por dia+refeição)", () => {
    const row = { id: U(9), day: "2026-11-14", meal: "almoco", title: "Feijoada", ingredients: ["feijão"], notes: null };
    expect(plan("casa", { acao: "editar", secao: "cardapio", id: U(9), dia: "2026-11-15" }, row)).toMatchObject({ ok: false, erro: expect.stringContaining("não muda na edição") });
    const p = okPlan("casa", { acao: "editar", secao: "cardapio", id: U(9), refeicao: "Almoço", nome: "Feijoada light" }, row);
    expect(p.preview.campos).toEqual([{ rotulo: "Prato", antes: "Feijoada", depois: "Feijoada light" }]);
    expect(okPlan("casa", { acao: "criar", secao: "cardapio", dia: "2026-11-14", refeicao: "café da manhã", nome: "Tapioca" }).raw.meal).toBe("cafe");
  });

  it("apagar mostra o item inteiro; documento só com dados", () => {
    const row = { id: U(9), kind: "garantia", title: "Geladeira", product: "Frost Free", store: null, purchase_date: "2026-01-10", warranty_until: null, amount: 3500, notes: null, file_path: "x" };
    const p = okPlan("casa", { acao: "apagar", secao: "documentos", id: U(9) }, row);
    expect(p.preview.titulo).toBe("Geladeira");
    expect(p.preview.campos).toEqual([
      { rotulo: "Tipo", antes: "Garantia", depois: null },
      { rotulo: "Título", antes: "Geladeira", depois: null },
      { rotulo: "Produto", antes: "Frost Free", depois: null },
      { rotulo: "Data da compra", antes: "10/01/2026", depois: null },
      { rotulo: "Valor", antes: expect.stringMatching(/R\$\s?3\.500,00/), depois: null },
    ]);
    const novo = okPlan("casa", { acao: "criar", secao: "documentos", nome: "Manual da TV", valor: 12.5 });
    expect(novo.raw).toMatchObject({ kind: "outro", title: "Manual da TV", amount: "12,50" });
  });

  it("concluir tarefa mostra de quem é a vez e a data", () => {
    const row = { id: U(9), name: "Lixo", frequency: "diaria", weekdays: null, month_day: null, rotation: [KAREN.id, ME.id], next_index: 0, next_due_on: "2026-11-12" };
    const p = okPlan("casa", { acao: "concluir", secao: "tarefas", id: U(9) }, row);
    expect(p.preview.campos).toEqual([
      { rotulo: "Vez de", antes: null, depois: "Karen" },
      { rotulo: "Prevista para", antes: null, depois: "12/11/2026" },
    ]);
  });

  it("pet: nome do pet resolvido (único é o padrão); ambíguo ou ausente pede para escolher", () => {
    const p = okPlan("pet", { acao: "criar", secao: "saude", tipo: "Vermífugo", nome: "Drontal", data: "2026-11-10" });
    expect(p.raw).toMatchObject({ pet_id: U(50), kind: "vermifugo", name: "Drontal", applied_on: "2026-11-10" });
    const two = { ...LK, pets: [{ id: U(50), name: "Moisés" }, { id: U(51), name: "Mel" }] };
    expect(plan("pet", { acao: "criar", secao: "saude", tipo: "vacina", nome: "V10" }, null, two)).toEqual({ ok: false, erro: "Pergunte de qual pet. Opções: Moisés, Mel." });
    expect(plan("pet", { acao: "criar", secao: "saude", tipo: "vacina", nome: "V10", pet: "Rex" }, null, two)).toMatchObject({ ok: false, erro: expect.stringContaining("Opções: Moisés, Mel") });
    expect(okPlan("pet", { acao: "criar", secao: "peso", peso_kg: 12.5 }).raw).toEqual({ pet_id: U(50), measured_on: "2026-11-13", weight_kg: "12.5" });
    expect(plan("pet", { acao: "criar", secao: "peso", peso_kg: 500 })).toMatchObject({ ok: false, erro: expect.stringContaining("Peso inválido") });
  });
});

describe("Oli escrita: Igreja (dono e anotação)", () => {
  const lesson = (over: Partial<Row> = {}): Row => ({ id: U(9), owner_id: ME.user_id, shared: false, title: "Aula 3", lesson_date: "2026-11-01", subject: null, teacher: null, notes: "Linha 1\nLinha 2", ...over });

  it("acrescentar junta a frase no fim sem perder o texto existente", () => {
    const p = okPlan("igreja", { acao: "acrescentar", secao: "carisma", id: U(9), frase: "  Deus é fiel.  " }, lesson());
    expect(p.raw.notes).toBe("Linha 1\nLinha 2\nDeus é fiel.");
    expect(p.preview.anexo).toEqual({ atual: "Linha 1\nLinha 2", acrescimo: "Deus é fiel." });
    expect(p.raw).toMatchObject({ title: "Aula 3", lesson_date: "2026-11-01" });
    const vazio = okPlan("igreja", { acao: "acrescentar", secao: "carisma", id: U(9), frase: "Primeira" }, lesson({ notes: null }));
    expect(vazio.raw.notes).toBe("Primeira");
    expect(vazio.preview.anexo).toEqual({ atual: null, acrescimo: "Primeira" });
    // Passou do limite da tela (10000): recusa em vez de cortar o texto.
    expect(plan("igreja", { acao: "acrescentar", secao: "carisma", id: U(9), frase: "fim" }, lesson({ notes: "a".repeat(9999) }))).toEqual({ ok: false, erro: "Anotações muito longo (máximo 10000)." });
  });

  it("só o dono altera ou apaga; item compartilhado pelo cônjuge é recusado", () => {
    const deKaren = lesson({ owner_id: KAREN.user_id, shared: true });
    for (const args of [
      { acao: "acrescentar", secao: "carisma", id: U(9), frase: "x" },
      { acao: "editar", secao: "carisma", id: U(9), titulo: "y" },
      { acao: "apagar", secao: "carisma", id: U(9) },
    ]) {
      expect(plan("igreja", args, deKaren)).toEqual({ ok: false, erro: NAO_E_SEU("Karen") });
    }
    const prayer = { id: U(8), owner_id: KAREN.user_id, shared: true, title: "Saúde da mãe", person: null, details: null, status: "orando", answered_on: null, answer_notes: null };
    expect(plan("igreja", { acao: "editar", secao: "oracoes", id: U(8), situacao: "respondida" }, prayer)).toEqual({ ok: false, erro: NAO_E_SEU("Karen") });
    expect(plan("igreja", { acao: "editar", secao: "oracoes", id: U(8), situacao: "respondida" }, { ...prayer, owner_id: ME.user_id })).toMatchObject({ ok: true });
  });

  it("edição preserva o compartilhamento; palavra x promessa conferidas", () => {
    const word = { id: U(7), owner_id: ME.user_id, shared: true, kind: "anotacao", title: "Culto", body: "Texto", received_on: "2026-11-01", reference: null, fulfilled_on: null };
    const p = okPlan("igreja", { acao: "editar", secao: "palavras", id: U(7), referencia: "Sl 23" }, word);
    expect(p.raw).toMatchObject({ shared: "on", kind: "anotacao", body: "Texto", reference: "Sl 23" });
    expect(plan("igreja", { acao: "editar", secao: "promessas", id: U(7), referencia: "Sl 23" }, word)).toEqual({ ok: false, erro: "Esse item é uma anotação: use a seção palavras." });
    expect(okPlan("igreja", { acao: "criar", secao: "promessas", texto: "Promessa" }).raw).toMatchObject({ kind: "promessa", body: "Promessa" });
  });
});

describe("Oli escrita: Confirmar e gravação pelas telas", () => {
  beforeEach(() => {
    calls.list = [];
  });

  it("o painel muda se o item mudou (o Confirmar compara antes de gravar)", () => {
    const row = { id: U(9), owner_id: ME.user_id, shared: false, title: "Aula", lesson_date: null, subject: null, teacher: null, notes: "A" };
    const args = { acao: "acrescentar", secao: "carisma", id: U(9), frase: "B" };
    const shown = okPlan("igreja", args, row).preview;
    expect(previewFingerprint(okPlan("igreja", args, row).preview)).toBe(previewFingerprint(shown));
    expect(previewFingerprint(okPlan("igreja", args, { ...row, notes: "A editado no outro celular" }).preview)).not.toBe(previewFingerprint(shown));
  });

  it("formulário da tela: id na edição, listas como campos repetidos", () => {
    const row = { id: U(9), name: "Lixo", notes: null, frequency: "semanal", weekdays: [1], month_day: null, rotation: [ME.id], next_index: 0, next_due_on: null };
    const p = okPlan("casa", { acao: "editar", secao: "tarefas", id: U(9), rodizio: ["Gabriel", "Karen"] }, row);
    const e = planToFormEntries(p);
    expect(e[0]).toEqual(["id", U(9)]);
    expect(e.filter(([k]) => k === "rotation")).toEqual([["rotation", ME.id], ["rotation", KAREN.id]]);
    expect(e.filter(([k]) => k === "weekdays")).toEqual([["weekdays", "1"]]);
    expect(planToFormEntries(okPlan("casa", { acao: "criar", secao: "compras", nome: "Pão" })).some(([k]) => k === "id")).toBe(false);
  });

  it("executa pelas actions das telas (apagar documento/dose usa o delete da tela, que remove o arquivo)", async () => {
    const { executarAlteracao } = await import("@/lib/oli/alterar-server");
    const doc = { id: U(9), kind: "garantia", title: "TV", product: null, store: null, purchase_date: null, warranty_until: null, amount: null, notes: null, file_path: "hh/docs/x.pdf" };
    await executarAlteracao({ ok: true, plan: okPlan("casa", { acao: "apagar", secao: "documentos", id: U(9) }, doc), row: doc });
    const dose = { id: U(8), pet_id: U(50), kind: "vacina", name: "V10", dose: null, applied_on: null, next_due_on: null, notes: null, file_path: "hh/pets/y.pdf" };
    await executarAlteracao({ ok: true, plan: okPlan("pet", { acao: "apagar", secao: "saude", id: U(8) }, dose), row: dose });
    const chore = { id: U(7), name: "Lixo", frequency: "diaria", weekdays: null, month_day: null, rotation: [ME.id], next_index: 0, next_due_on: "2026-11-13" };
    await executarAlteracao({ ok: true, plan: okPlan("casa", { acao: "concluir", secao: "tarefas", id: U(7) }, chore), row: chore });
    const aula = { id: U(6), owner_id: ME.user_id, shared: false, title: "Aula", lesson_date: null, subject: null, teacher: null, notes: "Antes" };
    await executarAlteracao({ ok: true, plan: okPlan("igreja", { acao: "acrescentar", secao: "carisma", id: U(6), frase: "Depois" }, aula), row: aula });
    expect(calls.list).toEqual([
      { fn: "deleteCasaDocument", arg: U(9) },
      { fn: "deletePetHealth", arg: U(8) },
      { fn: "completeChore", arg: [U(7), { next_index: 0, next_due_on: "2026-11-13" }] },
      { fn: "saveLesson", arg: [["id", U(6)], ["title", "Aula"], ["lesson_date", ""], ["subject", ""], ["teacher", ""], ["notes", "Antes\nDepois"]] },
    ]);
  });
});

describe("Oli escrita: painel de confirmação", () => {
  const render = (panels: OliPanel[]) => renderToStaticMarkup(createElement(OliPanels, { panels, onConfirm: () => {}, onCancel: () => {}, onClear: () => {} }));

  it("criar/editar/apagar/acrescentar: texto escapado, antes → depois, aviso de apagar e frase em destaque", () => {
    const criar = okPlan("casa", { acao: "criar", secao: "compras", nome: "<img src=x onerror=alert(1)>" }).preview;
    const editar = okPlan("casa", { acao: "editar", secao: "compras", id: U(9), nome: "Pão" }, { id: U(9), name: "Leite", quantity: null, unit: null, category: null, notes: null }).preview;
    const apagar = { ...okPlan("casa", { acao: "apagar", secao: "prestadores", id: U(9) }, { id: U(9), name: "José", service: "Elétrica", phone: null, email: null, notes: null }).preview, aviso: "Manutenções ligadas a este prestador ficam sem prestador." };
    const anexo = okPlan("igreja", { acao: "acrescentar", secao: "carisma", id: U(9), frase: "Frase nova" }, { id: U(9), owner_id: ME.user_id, shared: false, title: "Aula X", lesson_date: null, subject: null, teacher: null, notes: "Texto antigo" }).preview;
    const html = render([
      { id: "1", kind: "confirmar_alteracao", status: "pendente", data: criar },
      { id: "2", kind: "confirmar_alteracao", status: "pendente", data: editar },
      { id: "3", kind: "confirmar_alteracao", status: "pendente", data: apagar },
      { id: "4", kind: "confirmar_alteracao", status: "pendente", data: anexo },
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("Criar item de compra?");
    expect(html).toContain("Alterar item de compra?");
    expect(html).toMatch(/line-through">Leite<\/span>.*Pão/);
    expect(html).toContain("Apagar prestador?");
    expect(html).toContain("Não dá para desfazer");
    expect(html).toContain("Manutenções ligadas");
    expect(html).toContain("Acrescentar à anotação?");
    expect(html).toContain('data-testid="anexo-atual">Texto antigo<');
    expect(html).toContain('data-testid="anexo-novo">Frase nova<');
    expect(html.match(/>Confirmar</g)).toHaveLength(4);
    const done = render([{ id: "1", kind: "confirmar_alteracao", status: "criado", data: apagar }]);
    expect(done).toContain("Apagado.");
    expect(done).not.toContain(">Confirmar<");
  });
});
