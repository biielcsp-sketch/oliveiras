import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";
import { monthLabel, shiftMonth, yearMonthOf } from "../../src/lib/calendar";
import { todaySP } from "../../src/lib/financas/today";

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

    // Menu em ferradura: o botão central é o selecionado e troca o conteúdo abaixo
    const arc = page.getByRole("navigation", { name: "Seções de Igreja" });
    await expect(arc.locator('[aria-current="page"]')).toContainText("Resumo");
    await expect(page.getByRole("button", { name: /Todas as seções/ })).toHaveCount(0);
    await arc.getByRole("link", { name: "Consolidação" }).click();
    await expect(page).toHaveURL(/\/ministerio\/consolidacao$/);
    await expect(arc.getByRole("link", { name: "Consolidação" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Igreja");
    await expect(page.getByText("Integração com o app da Consolidação em breve").first()).toBeVisible();

    // Arrastar o arco para a direita e soltar: o botão que para no centro abre sozinho (sem toque)
    const box = (await arc.boundingBox())!;
    const y = box.y + box.height / 2;
    const center = box.x + box.width / 2;
    // Espera a Consolidação terminar de deslizar até o centro antes de arrastar
    await expect
      .poll(async () => {
        const b = (await arc.getByRole("link", { name: "Consolidação" }).boundingBox())!;
        return Math.abs(b.x + b.width / 2 - center);
      })
      .toBeLessThan(2);
    // ~2 botões para a direita (95px por botão): para no Resumo
    await page.mouse.move(center - 90, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(center - 90 + i * 18, y);
    await page.mouse.up();
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

  await test.step("Início: atalhos e módulos no cabeçalho; logo leva ao Início", async () => {
    await page.getByRole("link", { name: "Voltar para o Início" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Olá, Gabriel!");
    const mods = page.getByRole("navigation", { name: "Módulos" }).getByRole("link");
    await expect(mods).toHaveText(["Finanças", "Saúde", "Agenda", "Casa", "Igreja"]);
    await expect(mods.nth(2)).toHaveAttribute("href", "/agenda");
    // Rótulos do arco inteiros dentro da área azul do cabeçalho (a onda não passa por cima)
    const headBox = (await page.locator("header").first().boundingBox())!;
    for (const box of await mods.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(box.bottom).toBeLessThanOrEqual(headBox.y + headBox.height - 40);
    }
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
