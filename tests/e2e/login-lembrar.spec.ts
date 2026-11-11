import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, signUp, uniqueEmail } from "./helpers";

const COOKIE = "oliveiras_lembrar";

async function rememberedCookie(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === COOKIE);
}

async function login(page: Page, email: string, password: string, remember: boolean) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  const box = page.getByLabel("Lembrar neste aparelho");
  if (remember) await box.check();
  else await expect(box).not.toBeChecked();
  await page.locator("form").getByRole("button", { name: "Entrar", exact: true }).click();
}

async function signOut(page: Page) {
  await page.goto("/familia");
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test("lembrar: cookie HttpOnly só com a caixa marcada; sair mostra a tela do usuário lembrado", async ({ page }) => {
  const email = uniqueEmail("lembrar");
  await signUp(page, email);
  await page.context().clearCookies();

  await login(page, email, PASSWORD, true);
  await expect(page).toHaveURL(/\/(inicio|bem-vindo)$/);
  const cookie = await rememberedCookie(page);
  expect(cookie?.httpOnly).toBe(true);
  // O Next codifica o valor na URL (@ vira %40); o servidor decodifica ao ler.
  expect(decodeURIComponent(cookie?.value ?? "")).toBe(email);
  expect(cookie?.sameSite).toBe("Lax");

  // Conta nova cai em /bem-vindo: cria a família para chegar em /familia, onde fica o "Sair".
  if (/\/bem-vindo$/.test(page.url())) {
    await page.getByLabel("Seu nome").fill("Gabriel");
    await page.locator("form").getByRole("button", { name: "Criar família" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  }
  await signOut(page);
  expect(await rememberedCookie(page)).toBeDefined(); // sair não apaga o cookie

  const masked = `${email[0]}***${email.slice(email.indexOf("@"))}`;
  await expect(page.getByText(masked)).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar com digital" })).toBeVisible();
  await expect(page.getByLabel("Senha")).toHaveCount(0);

  await page.getByRole("button", { name: "Usar a senha" }).click();
  await expect(page.getByLabel("E-mail")).toHaveValue(email);

  await page.goto("/login");
  await page.getByRole("button", { name: "Não sou eu / Esquecer este aparelho" }).click();
  await expect(page.getByLabel("E-mail")).toHaveValue("");
  await expect(page.getByLabel("Lembrar neste aparelho")).not.toBeChecked();
  expect(await rememberedCookie(page)).toBeUndefined();
});

test("lembrar: sem marcar a caixa ou com senha errada não cria cookie", async ({ page }) => {
  const email = uniqueEmail("semlembrar");
  await signUp(page, email);
  await page.context().clearCookies();

  await login(page, email, "SenhaErrada#999", true);
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
  expect(await rememberedCookie(page)).toBeUndefined();

  await login(page, email, PASSWORD, false);
  await expect(page).toHaveURL(/\/(inicio|bem-vindo)$/);
  expect(await rememberedCookie(page)).toBeUndefined();
});

test("lembrar: cookie com valor inválido é ignorado e mostra o formulário", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: COOKIE, value: "nao-e-email", url: baseURL! }]);
  await page.goto("/login");
  await expect(page.getByLabel("E-mail")).toHaveValue("");
});
