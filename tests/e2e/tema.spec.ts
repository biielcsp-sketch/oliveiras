import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

const bg = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("botão claro/escuro: alterna, lembra a escolha e sem escolha segue o aparelho", async ({ page }) => {
  const problems = watchConsole(page);
  await signUp(page, uniqueEmail("tema"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  // Sem escolha: segue o aparelho (Playwright emula claro).
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect(await bg(page)).toBe("rgb(238, 241, 244)");

  await page.getByRole("button", { name: "Mudar para o modo escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => bg(page)).toBe("rgb(10, 20, 28)");

  // A escolha vale depois de recarregar (cookie lido pelo servidor, sem piscar).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bg(page)).toBe("rgb(10, 20, 28)");
  // A barra do navegador e a decoração acompanham a escolha, não o aparelho.
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0a141c");
  const plexus = page.locator("svg[aria-hidden]").filter({ has: page.locator("line") }).first();
  if (await plexus.count()) expect(await plexus.evaluate((e) => getComputedStyle(e).opacity)).toBe("0.1");

  await page.getByRole("button", { name: "Mudar para o modo claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => bg(page)).toBe("rgb(238, 241, 244)");

  // Escolha "claro" vence o aparelho em modo escuro.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await bg(page)).toBe("rgb(238, 241, 244)");

  expect(problems, "erros de console/CSP").toEqual([]);
});
