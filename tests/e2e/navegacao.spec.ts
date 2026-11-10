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

  await test.step("barra inferior: 5 itens na ordem, mini Oli no centro levando ao Início", async () => {
    const nav = page.getByRole("navigation", { name: "Principal" });
    const links = nav.getByRole("link");
    await expect(links).toHaveText(["Finanças", "Saúde", "", "Casa", "Igreja"]);
    const names = await links.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim()));
    expect(names).toEqual(["Finanças", "Saúde", "Oli, tela inicial", "Casa", "Igreja"]);
    const oli = nav.getByRole("link", { name: "Oli, tela inicial" });
    await expect(oli).toHaveAttribute("href", "/inicio");
    await expect(oli).toHaveAttribute("aria-current", "page");
    // Imagem estática do avatar (não 3D), carregada de verdade
    const img = oli.locator("img");
    await expect(img).toHaveAttribute("src", "/oli/oli-mini.webp");
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBe(192);
    // Início não fica na barra inferior
    await expect(nav.getByRole("link", { name: "Início" })).toHaveCount(0);

    await nav.getByRole("link", { name: "Igreja" }).click();
    await expect(page).toHaveURL(/\/ministerio$/);
    await expect(nav.getByRole("link", { name: "Igreja" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Igreja");

    // Menu em ferradura: o botão central é o selecionado e troca o conteúdo abaixo
    const arc = page.getByRole("navigation", { name: "Seções de Igreja" });
    await expect(arc.getByRole("button", { name: "Escalas" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Escalas de serviço (vão para a agenda)")).toBeVisible();
    await arc.getByRole("button", { name: "Pessoas" }).click();
    await expect(arc.getByRole("button", { name: "Pessoas" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Pessoas acompanhadas e follow-up")).toBeVisible();

    await nav.getByRole("link", { name: "Oli, tela inicial" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByTestId("oli-stage")).toBeVisible();
  });

  await test.step("logo leva ao Início", async () => {
    await page.getByRole("link", { name: /ir para o Início/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  await test.step("botão Agenda abre o calendário do mês atual e fecha com Esc", async () => {
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
