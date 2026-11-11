import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

test("sem login, páginas internas redirecionam para /login", async ({ page }) => {
  for (const path of ["/inicio", "/familia", "/financas", "/bem-vindo"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("família: criar, adicionar dependente, convidar e isolar de terceiros", async ({ browser }) => {
  // A cria a família
  const a = await (await browser.newContext()).newPage();
  const aProblems = watchConsole(a);
  await signUp(a, uniqueEmail("a"));
  await a.getByLabel("Seu nome").fill("Gabriel");
  await a.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(a).toHaveURL(/\/inicio$/);
  await expect(a.getByRole("heading", { level: 1 })).toContainText("Gabriel");

  await a.goto("/familia");
  await a.getByPlaceholder("Nome do dependente").fill("Filho Teste");
  await a.getByLabel("Nascimento").fill("2022-03-10");
  await a.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(a.getByText("Filho Teste")).toBeVisible();
  const code = (await a.locator("p.font-mono").innerText()).trim();
  expect(code).toMatch(/^[0-9A-F]{8}$/);

  // B entra pelo código e vê os 3 membros
  const b = await (await browser.newContext()).newPage();
  await signUp(b, uniqueEmail("b"));
  await b.getByRole("button", { name: "Entrar com código" }).click();
  await b.getByLabel("Código de convite").fill(code.toLowerCase());
  await b.getByLabel("Seu nome").fill("Karen");
  await b.getByRole("button", { name: "Entrar na família" }).click();
  await expect(b).toHaveURL(/\/inicio$/);
  await b.goto("/familia");
  for (const name of ["Gabriel", "Karen", "Filho Teste"]) {
    await expect(b.locator("li").filter({ hasText: name })).toHaveCount(1);
  }

  // C cria outra família e não enxerga ninguém da família de A
  const c = await (await browser.newContext()).newPage();
  await signUp(c, uniqueEmail("c"));
  await c.getByLabel("Nome da família").fill("Família C");
  await c.getByLabel("Seu nome").fill("Carlos");
  await c.locator("form").getByRole("button", { name: "Criar família" }).click();
  // Espera a família ser criada (vai para /inicio) antes de navegar; sem isso o goto pode cancelar o envio
  await expect(c).toHaveURL(/\/inicio$/);
  await c.goto("/familia");
  await expect(c.locator("li").filter({ hasText: "Carlos" })).toHaveCount(1);
  for (const name of ["Gabriel", "Karen", "Filho Teste"]) {
    await expect(c.locator("li").filter({ hasText: name })).toHaveCount(0);
  }

  // Código inválido é recusado
  const d = await (await browser.newContext()).newPage();
  await signUp(d, uniqueEmail("d"));
  await d.getByRole("button", { name: "Entrar com código" }).click();
  await d.getByLabel("Código de convite").fill("ZZZZZZZZ");
  await d.getByLabel("Seu nome").fill("Intruso");
  await d.getByRole("button", { name: "Entrar na família" }).click();
  await expect(d.getByText("Código inválido.")).toBeVisible();

  expect(aProblems, "erros de console/CSP").toEqual([]);
});
