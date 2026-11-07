import { expect, type Page } from "@playwright/test";

export const PASSWORD = "SenhaForte#2026";

export function uniqueEmail(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@teste.invalid`;
}

/** Cria conta (Supabase local sem confirmação de e-mail) e chega em /bem-vindo. */
export async function signUp(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Criar conta" }).first().click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/bem-vindo$/);
}

/** Coleta violações de CSP e erros de JS durante o teste. */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));
  return problems;
}
