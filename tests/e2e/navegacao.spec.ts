import { expect, test, type Locator, type Page } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";
import { monthLabel, shiftMonth, yearMonthOf } from "../../src/lib/calendar";
import { todaySP } from "../../src/lib/financas/today";

/** Rótulos dos botões visíveis da ferradura (opacidade > 0,5), da esquerda para a direita. */
async function visibleArc(arc: Locator) {
  return arc.getByRole("link").evaluateAll((els) =>
    els
      .filter((e) => Number(getComputedStyle(e).opacity) > 0.5)
      .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
      .map((e) => e.textContent?.trim()),
  );
}

/** O botão `name` está no centro do arco (parado) e com o contorno de selecionado. */
async function expectCentered(arc: Locator, name: string) {
  const box = (await arc.boundingBox())!;
  await expect
    .poll(async () => {
      const b = (await arc.getByRole("link", { name }).boundingBox())!;
      return Math.abs(b.x + b.width / 2 - (box.x + box.width / 2));
    })
    .toBeLessThan(2);
  await expect(arc.getByRole("link", { name }).locator('[data-selected="true"]')).toHaveCount(1);
  await expect(arc.locator('[data-selected="true"]')).toHaveCount(1);
}

/** Arrasta o arco `dx` px na horizontal (positivo = para a direita), em passos, e solta. */
async function dragArc(page: Page, arc: Locator, dx: number) {
  const box = (await arc.boundingBox())!;
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2 - dx / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (dx * i) / 10, y);
  await page.mouse.up();
}

test("navegação: barra inferior, logo para o Início e calendário da Agenda", async ({ page }) => {
  const problems = watchConsole(page);
  await signUp(page, uniqueEmail("nav"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  await test.step("barra inferior: 5 ícones na ordem, esfera do Oli no centro levando à tela do assistente", async () => {
    const nav = page.getByRole("navigation", { name: "Principal" });
    const links = nav.getByRole("link");
    const names = await links.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names).toEqual(["Finanças", "Saúde", "Oli, o assistente", "Casa", "Igreja"]);
    const oli = nav.getByRole("link", { name: "Oli, o assistente" });
    await expect(oli).toHaveAttribute("href", "/assistente");
    // Saúde abre na raiz (Carteirinhas no centro da ferradura)
    await expect(nav.getByRole("link", { name: "Saúde" })).toHaveAttribute("href", "/saude");
    await expect(oli).not.toHaveAttribute("aria-current", "page");
    // Esfera animada só com CSS (sem imagem do avatar antigo)
    await expect(oli.getByTestId("oli-sphere")).toBeVisible();
    await expect(oli.locator("img")).toHaveCount(0);
    // Área de toque de pelo menos 44px em cada ícone
    for (const box of await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
    await expect(nav.getByRole("link", { name: "Início" })).toHaveCount(0);

    await nav.getByRole("link", { name: "Igreja" }).click();
    await expect(page).toHaveURL(/\/ministerio$/);
    await expect(nav.getByRole("link", { name: "Igreja" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Igreja");

    // Menu em ferradura: só 3 botões visíveis, o do meio é o selecionado e troca o conteúdo abaixo
    const arc = page.getByRole("navigation", { name: "Seções de Igreja" });
    await expect(arc.locator('[aria-current="page"]')).toContainText("Resumo");
    await expect.poll(() => visibleArc(arc)).toEqual(["Devocional", "Resumo", "Carisma"]);
    await expect(page.getByRole("button", { name: /Todas as seções/ })).toHaveCount(0);
    await arc.getByRole("link", { name: "Carisma" }).click();
    await expect(page).toHaveURL(/\/ministerio\/carisma$/);
    await expect(arc.getByRole("link", { name: "Carisma" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Igreja");
    await expect.poll(() => visibleArc(arc)).toEqual(["Resumo", "Carisma", "Consolidação"]);
    await expectCentered(arc, "Carisma");

    // Arrastar o arco para a direita e soltar: o botão que para no centro abre sozinho (sem toque)
    await dragArc(page, arc, 90);
    await expect(page).toHaveURL(/\/ministerio$/);
    await expect(arc.locator('[aria-current="page"]')).toContainText("Resumo");

    // Teclado: seta para a direita leva à próxima seção e mantém o foco no botão dela
    await arc.getByRole("link", { name: "Resumo" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/ministerio\/carisma$/);
    await expect(arc.getByRole("link", { name: "Carisma" })).toHaveAttribute("aria-current", "page");
    await expect(arc.getByRole("link", { name: "Carisma" })).toBeFocused();

    // Logo do cabeçalho do módulo leva ao Início
    await page.getByRole("link", { name: /ir para o Início/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);

    await nav.getByRole("link", { name: "Oli, o assistente" }).click();
    await expect(page).toHaveURL(/\/assistente$/);
    await expect(oli).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("oli-stage")).toBeVisible();
  });

  await test.step("Saúde: ferradura circular, sempre 3 visíveis na primeira e na última aba; teclado dá a volta", async () => {
    await page.goto("/saude");
    const arc = page.getByRole("navigation", { name: "Seções de Saúde" });
    // Primeira aba: a vizinha da esquerda é a última (Vacinas)
    await expect.poll(() => visibleArc(arc)).toEqual(["Vacinas", "Carteirinhas", "Consultas"]);
    await expectCentered(arc, "Carteirinhas");
    await expect(arc.locator('[aria-current="page"]')).toHaveText("Carteirinhas");
    // Leitores de tela/Tab: cada aba uma vez, na ordem real (sem clones)
    await expect(arc.getByRole("link")).toHaveText(["Carteirinhas", "Consultas", "Exames", "Procedimentos", "Medicamentos", "Vacinas"]);
    // Seta para a esquerda na primeira vai para a última
    await arc.getByRole("link", { name: "Carteirinhas" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/\/saude\/vacinas$/);
    await expect(arc.getByRole("link", { name: "Vacinas" })).toHaveAttribute("aria-current", "page");
    await expect(arc.getByRole("link", { name: "Vacinas" })).toBeFocused();
    // Última aba: também 3, com a primeira à direita
    await expect.poll(() => visibleArc(arc)).toEqual(["Medicamentos", "Vacinas", "Carteirinhas"]);
    await expectCentered(arc, "Vacinas");
    // Seta para a direita na última volta para a primeira
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/saude$/);
    await expect(arc.getByRole("link", { name: "Carteirinhas" })).toHaveAttribute("aria-current", "page");
    await expect(arc.getByRole("link", { name: "Carteirinhas" })).toBeFocused();
    // Arrastar para a direita a partir da primeira também dá a volta (para na última e troca a tela)
    await expectCentered(arc, "Carteirinhas");
    await dragArc(page, arc, 90);
    await expect(page).toHaveURL(/\/saude\/vacinas$/);
    await expect.poll(() => visibleArc(arc)).toEqual(["Medicamentos", "Vacinas", "Carteirinhas"]);
    await page.goto("/assistente");
  });

  await test.step("Início: atalhos e módulos no cabeçalho; logo leva ao Início", async () => {
    await page.getByRole("link", { name: "Voltar para o Início" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Olá, Gabriel!");
    const mods = page.getByRole("navigation", { name: "Módulos" }).getByRole("link");
    await expect(mods).toHaveText(["Finanças", "Saúde", "Agenda", "Casa", "Igreja"]);
    await expect(mods.nth(2)).toHaveAttribute("href", "/agenda");
    // Arco do Início = ferradura com 3 visíveis; começa com a Agenda no centro (destacada), sem aba "atual"
    const homeArc = page.getByRole("navigation", { name: "Módulos" });
    await expect.poll(() => visibleArc(homeArc)).toEqual(["Saúde", "Agenda", "Casa"]);
    await expectCentered(homeArc, "Agenda");
    await expect(homeArc.locator("[aria-current]")).toHaveCount(0);
    // Rótulos e bolhas visíveis inteiros dentro da tela e da área azul do cabeçalho (a onda não passa por cima)
    const headBox = (await page.locator("header").first().boundingBox())!;
    const boxes = await mods.evaluateAll((els) =>
      els.filter((e) => Number(getComputedStyle(e).opacity) > 0.5).map((e) => e.getBoundingClientRect().toJSON()),
    );
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(box.bottom).toBeLessThanOrEqual(headBox.y + headBox.height - 30);
    }
    // Bolhas grandes (~64px)
    const orb = (await homeArc.getByRole("link", { name: "Agenda" }).locator("span").first().boundingBox())!;
    expect(orb.width).toBeGreaterThanOrEqual(62);
    // Resumo abaixo do arco = item do centro (Agenda), com título visível e região aria-live
    const panel = page.getByTestId("home-panel");
    await expect(panel).toHaveAttribute("data-panel", "agenda");
    await expect(panel).toHaveAttribute("aria-live", "polite");
    await expect(panel.getByRole("heading", { name: "Próximos eventos" })).toBeVisible();
    // Arrastar só desliza (não navega); o novo centro fica destacado e o resumo troca sozinho (sem clique)
    await dragArc(page, homeArc, -90);
    await expect.poll(() => visibleArc(homeArc)).toEqual(["Agenda", "Casa", "Igreja"]);
    await expectCentered(homeArc, "Casa");
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(panel).toHaveAttribute("data-panel", "casa");
    await expect(panel.getByRole("heading", { name: "Resumo da Casa" })).toBeVisible();
    await expect(panel.getByTestId("resumo-compras")).toBeVisible();
    await expect(panel.getByTestId("resumo-pet")).toBeVisible();
    await expect(panel.getByTestId("resumo-prestadores")).toHaveCount(0);
    // Seta do teclado também troca o resumo
    await homeArc.getByRole("link", { name: "Casa" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(panel).toHaveAttribute("data-panel", "agenda");
    // O foco acompanha o item só no próximo quadro: espera antes da próxima seta (senão a seta parte do item antigo)
    await expect(homeArc.getByRole("link", { name: "Agenda" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(panel).toHaveAttribute("data-panel", "saude");
    await expect(homeArc.getByRole("link", { name: "Saúde" })).toBeFocused();
    await expect(panel.getByRole("heading", { name: "Próximas consultas e exames" })).toBeVisible();
    await expect(panel.getByText("Nenhuma consulta ou exame marcado.")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(homeArc.getByRole("link", { name: "Agenda" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(panel).toHaveAttribute("data-panel", "casa");
    await expectCentered(homeArc, "Casa");
    // Circular também no Início: depois de Igreja vem Finanças (sempre 3 visíveis)
    await dragArc(page, homeArc, -90);
    await expect.poll(() => visibleArc(homeArc)).toEqual(["Casa", "Igreja", "Finanças"]);
    await expectCentered(homeArc, "Igreja");
    await expect(panel).toHaveAttribute("data-panel", "ministerio");
    await expect(panel.getByTestId("igreja-resumo-carisma")).toBeVisible();
    await dragArc(page, homeArc, 90);
    await expect.poll(() => visibleArc(homeArc)).toEqual(["Agenda", "Casa", "Igreja"]);
    await expectCentered(homeArc, "Casa");
    await expect(page).toHaveURL(/\/inicio$/);
    // Tocar abre o módulo
    await homeArc.getByRole("link", { name: "Casa" }).click();
    await expect(page).toHaveURL(/\/casa$/);
    await page.goto("/inicio");
    // Topo do celular: tema à esquerda, logo no centro, família à direita; sem botão de agenda
    await expect(page.getByRole("button", { name: "Agenda", exact: true })).toHaveCount(0);
    const theme = (await page.getByRole("button", { name: /Mudar para o modo/ }).boundingBox())!;
    const logo = (await page.getByTestId("head-logo").boundingBox())!;
    const fam = (await page.getByRole("link", { name: "Família" }).boundingBox())!;
    expect(theme.x + theme.width).toBeLessThan(logo.x);
    expect(logo.x + logo.width).toBeLessThan(fam.x);
    expect(Math.abs(logo.x + logo.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(4);
    expect(theme.height).toBeLessThanOrEqual(36);
    await expect(page.getByRole("link", { name: "Família" })).toHaveAttribute("href", "/familia");
    await page.getByRole("link", { name: /ir para o Início/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  await test.step("botão Agenda (barra lateral do desktop) abre o calendário do mês atual e fecha com Esc", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const today = todaySP();
    const current = yearMonthOf(today);
    const trigger = page.getByRole("button", { name: "Agenda", exact: true });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(monthLabel(current));
    await expect(dialog.locator('[aria-current="date"]')).toContainText(String(Number(today.slice(8))));
    await expect(dialog.getByRole("link", { name: "Abrir agenda" })).toHaveAttribute("href", "/agenda");

    await dialog.getByRole("button", { name: "Próximo mês" }).click();
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(monthLabel(shiftMonth(current, 1)));
    await expect(dialog.locator('[aria-current="date"]')).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Reabre no mês atual; fecha pelo X e por clique fora
    await trigger.click();
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(monthLabel(current));
    await dialog.getByRole("button", { name: "Fechar calendário" }).click();
    await expect(dialog).toBeHidden();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
  });

  expect(problems).toEqual([]);
});

test("página não encontrada: visual do app, sem violar a CSP", async ({ page }) => {
  const problems = watchConsole(page);
  // Sem login, o proxy manda para /login; com login, a rota inexistente mostra a 404 do app.
  await signUp(page, uniqueEmail("404"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  const res = await page.goto("/pagina-que-nao-existe");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Conte sempre");
  await expect(page.getByText("com propósito e fé.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Oli" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Voltar para o início" })).toHaveAttribute("href", "/inicio");
  // O único erro aceito é o próprio 404 do documento.
  expect(problems.filter((p) => !/status of 404/.test(p))).toEqual([]);
  // Sem rolagem lateral (as manchas de luz do fundo ficam dentro da tela)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
