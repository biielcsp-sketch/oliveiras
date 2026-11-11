import { expect, test, type Page } from "@playwright/test";
import { addDays, brDate, toSpDate } from "../../src/lib/agenda/dates";
import { addMonths } from "../../src/lib/casa/schedule";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

/** Família própria da Casa (criada pela interface, e-mail único): titular "Gabriel" + dependente "Filho Teste". */
async function createFamily(page: Page, tag: string, dependent?: string) {
  await signUp(page, uniqueEmail(tag));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  if (!dependent) return;
  await page.goto("/familia");
  await page.getByPlaceholder("Nome do dependente").fill(dependent);
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText(dependent)).toBeVisible();
}

const status = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

test("Casa sem login redireciona para /login", async ({ page }) => {
  for (const path of ["/casa", "/casa/compras", "/casa/tarefas", "/casa/manutencao"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("Casa: compras, tarefas com rodízio e manutenção (isolada de outra família)", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const problems = watchConsole(a);
  await createFamily(a, "casa-a", "Filho Teste");
  const today = toSpDate(new Date());

  await test.step("menu em ferradura leva às seções", async () => {
    await a.goto("/casa");
    await expect(a.getByRole("heading", { level: 1 })).toHaveText("Casa");
    await expect(a.getByRole("navigation", { name: "Seções de Casa" })).toBeVisible();
    await expect(a.getByTestId("resumo-compras")).toContainText("Nada para comprar.");
  });

  await test.step("lista: adicionar, editar, marcar, limpar comprados e apagar", async () => {
    await a.goto("/casa/compras");
    await expect(a.getByText("A lista está vazia.")).toBeVisible();
    const add = a.getByRole("form", { name: "Adicionar à lista" });
    await add.getByLabel("Item", { exact: true }).fill("Leite");
    await add.getByRole("button", { name: "Adicionar" }).click();
    await expect(status(a, "Leite adicionado à lista.")).toBeVisible();
    await expect(add.getByLabel("Item", { exact: true })).toHaveValue("");

    await add.getByLabel("Item", { exact: true }).fill("Sabão");
    await add.getByRole("button", { name: /Mais detalhes/ }).click();
    await add.getByLabel("Quantidade", { exact: true }).fill("2");
    await add.getByLabel("Unidade").fill("un");
    await add.getByLabel("Categoria").fill("Limpeza");
    await add.getByRole("button", { name: "Adicionar" }).click();
    await expect(status(a, "Sabão adicionado à lista.")).toBeVisible();
    await expect(a.getByRole("region", { name: "Limpeza" })).toContainText("Sabão · 2 un");
    await expect(a.getByRole("region", { name: "Sem categoria" })).toContainText("Leite");

    await a.getByRole("button", { name: "Editar Sabão" }).click();
    const d = a.getByRole("dialog", { name: "Editar item" });
    await d.getByLabel("Item", { exact: true }).fill("Sabão em pó");
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(status(a, "Item atualizado.")).toBeVisible();
    await expect(a.getByRole("region", { name: "Limpeza" })).toContainText("Sabão em pó");

    await a.getByRole("checkbox", { name: "Leite" }).check();
    await expect(a.getByRole("region", { name: "Comprados" })).toContainText("Leite");
    await a.getByRole("checkbox", { name: "Leite" }).uncheck();
    await expect(a.getByRole("region", { name: "Comprados" })).toHaveCount(0);
    await a.getByRole("checkbox", { name: "Leite" }).check();
    await a.getByRole("button", { name: "Limpar comprados" }).click();
    await expect(status(a, "Comprados removidos da lista.")).toBeVisible();
    await expect(a.getByRole("checkbox", { name: "Leite" })).toHaveCount(0);

    const row = a.getByTestId("item-compra").filter({ hasText: "Sabão em pó" });
    await row.getByRole("button", { name: "Apagar" }).click();
    await row.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(a.getByTestId("item-compra")).toHaveCount(0);
  });

  await test.step("lista: dois aparelhos marcam o mesmo item ao mesmo tempo (sem erro e sem duplicar)", async () => {
    await a.goto("/casa/compras");
    const add = a.getByRole("form", { name: "Adicionar à lista" });
    await add.getByLabel("Item", { exact: true }).fill("Café");
    await add.getByRole("button", { name: "Adicionar" }).click();
    await expect(status(a, "Café adicionado à lista.")).toBeVisible();
    await a.goto("/casa");
    await expect(a.getByTestId("resumo-compras")).toContainText("1 item para comprar");

    const a2 = await ctxA.newPage();
    await Promise.all([a.goto("/casa/compras"), a2.goto("/casa/compras")]);
    await Promise.all([a.getByRole("checkbox", { name: "Café" }).click(), a2.getByRole("checkbox", { name: "Café" }).click()]);
    await expect(a.getByRole("region", { name: "Comprados" })).toContainText("Café");
    await expect(a2.getByRole("region", { name: "Comprados" })).toContainText("Café");
    await expect(a.getByText(/Não foi possível|não encontrado/)).toHaveCount(0);
    await expect(a2.getByText(/Não foi possível|não encontrado/)).toHaveCount(0);
    await a2.close();
    await a.reload();
    await expect(a.getByRole("checkbox", { name: "Café" })).toHaveCount(1);
    await a.getByRole("button", { name: "Limpar comprados" }).click();
    await expect(a.getByRole("checkbox", { name: "Café" })).toHaveCount(0);
  });

  await test.step("tarefa com rodízio de 2 pessoas: Feita alterna o responsável; pular a vez", async () => {
    await a.goto("/casa/tarefas");
    await a.getByRole("button", { name: "Nova tarefa" }).click();
    const d = a.getByRole("dialog", { name: "Nova tarefa" });
    await d.getByLabel("Tarefa", { exact: true }).fill("Lavar a louça");
    await d.getByLabel("Frequência").selectOption("diaria");
    await d.getByRole("button", { name: "Gabriel", exact: true }).click();
    await d.getByRole("button", { name: "Filho Teste", exact: true }).click();
    await expect(d.getByRole("list", { name: "Ordem do rodízio" })).toContainText("1. Gabriel");
    await d.getByRole("button", { name: "Criar tarefa" }).click();
    await expect(status(a, "Tarefa criada.")).toBeVisible();

    const hoje = a.getByRole("region", { name: "Hoje" });
    const card = a.getByTestId("tarefa").filter({ hasText: "Lavar a louça" });
    await expect(hoje.getByTestId("tarefa")).toHaveCount(1);
    await expect(card.getByTestId("responsavel")).toHaveText("Gabriel");

    // Dois aparelhos com a mesma tela apertam "Feita" juntos: avança uma vez só.
    const a2 = await ctxA.newPage();
    await a2.goto("/casa/tarefas");
    const card2 = a2.getByTestId("tarefa").filter({ hasText: "Lavar a louça" });
    await expect(card2.getByTestId("responsavel")).toHaveText("Gabriel");
    await Promise.all([card.getByRole("button", { name: "Feita" }).click(), card2.getByRole("button", { name: "Feita" }).click()]);
    const stale = (p: Page) => p.getByText("A tarefa já foi atualizada em outro aparelho.");
    await expect.poll(async () => (await status(a, "Lavar a louça: feita.").count()) + (await status(a2, "Lavar a louça: feita.").count())).toBe(1);
    await expect.poll(async () => (await stale(a).count()) + (await stale(a2).count())).toBe(1);
    await a2.close();
    await a.reload();
    await expect(card.getByTestId("responsavel")).toHaveText("Filho Teste");
    await expect(a.getByRole("region", { name: "Próximas" }).getByTestId("tarefa")).toHaveCount(1);

    await card.getByRole("button", { name: "Feita" }).click();
    await expect(card.getByTestId("responsavel")).toHaveText("Gabriel");

    await card.getByRole("button", { name: "Pular a vez" }).click();
    await expect(card.getByTestId("responsavel")).toHaveText("Filho Teste");

    await card.getByText("Histórico").click();
    const hist = card.getByRole("list", { name: "Histórico de Lavar a louça" });
    await expect(hist.getByRole("listitem")).toHaveCount(2);
    await expect(hist).toContainText(`${brDate(today)} · Gabriel`);
    await expect(hist).toContainText(`${brDate(today)} · Filho Teste`);
  });

  await test.step("pessoa removida da família é pulada no rodízio e sai ao editar", async () => {
    await a.goto("/familia");
    await a.getByRole("button", { name: "Remover Filho Teste" }).click();
    await expect(a.getByText("Filho Teste")).toHaveCount(0);
    await a.goto("/casa/tarefas");
    const card = a.getByTestId("tarefa").filter({ hasText: "Lavar a louça" });
    // Era a vez dele: passa para o próximo válido.
    await expect(card.getByTestId("responsavel")).toHaveText("Gabriel");
    await expect(card.getByRole("button", { name: "Pular a vez" })).toHaveCount(0);
    await card.getByRole("button", { name: "Feita" }).click();
    await expect(status(a, "Lavar a louça: feita.")).toBeVisible();
    await expect(card.getByTestId("responsavel")).toHaveText("Gabriel");
    await card.getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar tarefa" });
    await expect(d.getByRole("list", { name: "Ordem do rodízio" }).getByRole("listitem")).toHaveCount(1);
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(status(a, "Tarefa atualizada.")).toBeVisible();
    await expect(card.getByTestId("responsavel")).toHaveText("Gabriel");
  });

  await test.step("manutenção: vencida; Feita hoje recalcula a próxima data", async () => {
    await a.goto("/casa/manutencao");
    await a.getByRole("button", { name: "Nova manutenção" }).click();
    const d = a.getByRole("dialog", { name: "Nova manutenção" });
    await d.getByLabel("Manutenção", { exact: true }).fill("Filtro de água");
    await d.getByLabel("A cada").fill("6");
    await d.getByLabel("Unidade").selectOption("meses");
    const last = addDays(today, -200);
    await d.getByLabel("Última vez feita").fill(last);
    await d.getByLabel("Prestador (texto livre)").fill("Loja do Filtro");
    await d.getByRole("button", { name: "Salvar manutenção" }).click();
    await expect(status(a, "Manutenção salva.")).toBeVisible();
    const card = a.getByTestId("manutencao").filter({ hasText: "Filtro de água" });
    await expect(card).toContainText("Vencida");
    await expect(card.getByTestId("proxima")).toContainText(brDate(addMonths(last, 6)));

    await a.goto("/casa");
    await expect(a.getByTestId("resumo-manutencao")).toContainText("1 vencida");

    await a.goto("/casa/manutencao");
    await card.getByRole("button", { name: "Feita hoje" }).click();
    await expect(status(a, "Filtro de água: registrada hoje.")).toBeVisible();
    await expect(card.getByTestId("proxima")).toHaveText(`Próxima: ${brDate(addMonths(today, 6))}`);
    await expect(card).not.toContainText("Vencida");

    await card.getByRole("button", { name: "Outra data" }).click();
    const done = a.getByRole("dialog", { name: "Registrar: Filtro de água" });
    await done.getByLabel("Feita em").fill(addDays(today, -1));
    await done.getByLabel("Custo (opcional)").fill("89,90");
    await done.getByRole("button", { name: "Registrar" }).click();
    await expect(status(a, "Manutenção registrada.")).toBeVisible();
    // Data mais antiga não faz a próxima voltar.
    await expect(card.getByTestId("proxima")).toHaveText(`Próxima: ${brDate(addMonths(today, 6))}`);
    await card.getByText("Histórico").click();
    await expect(card).toContainText("R$ 89,90");
  });

  await test.step("outra família não vê os dados da Casa", async () => {
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await createFamily(b, "casa-b");
    await b.goto("/casa");
    await expect(b.getByTestId("resumo-compras")).toContainText("Nada para comprar.");
    await expect(b.getByTestId("resumo-tarefas")).toContainText("0 tarefas para hoje");
    await b.goto("/casa/compras");
    await expect(b.getByText("A lista está vazia.")).toBeVisible();
    await b.goto("/casa/tarefas");
    await expect(b.getByText("Nenhuma tarefa ainda.")).toBeVisible();
    await b.goto("/casa/manutencao");
    await expect(b.getByText("Nenhuma manutenção ainda.")).toBeVisible();
    await ctxB.close();
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/.test(p))).toEqual([]);
  await ctxA.close();
});
