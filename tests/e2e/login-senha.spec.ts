import { expect, test } from "@playwright/test";
import { PASSWORD, signUp, uniqueEmail, watchConsole } from "./helpers";

// O Supabase local do CI sobe sem o servidor de e-mail (mailpit), então o link real do e-mail não é lido aqui:
// a página de redefinição é exercitada com uma sessão normal (mesma checagem do servidor: getClaims) e o
// callback é testado com código inválido. A validação do `next` com código válido está em tests/unit.
const GENERIC = "Se esse e-mail tiver conta, enviamos um link para redefinir a senha.";

test("login: seletor Entrar/Criar conta removido; texto alterna o modo", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/login");

  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toHaveCount(1); // só o submit
  await expect(page.getByRole("button", { name: "Criar conta", exact: true })).toHaveCount(1); // só o texto clicável
  await expect(page.getByText("Não tem conta?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toBeVisible();

  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(page.getByText("Já tem conta?")).toBeVisible();
  await expect(page.getByLabel("Senha")).toHaveAttribute("autocomplete", "new-password");
  await expect(page.locator("form").getByRole("button", { name: "Criar conta", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Entrar com digital" })).toHaveCount(0);

  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Não tem conta?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("login: palco do Oli presente (3D, imagem estática sem GPU ou aviso)", async ({ page }) => {
  await page.goto("/login");
  const stage = page.getByTestId("oli-stage");
  await expect(stage).toBeVisible();
  await expect(
    stage
      .locator("canvas")
      .or(stage.locator('img[src="/oli/oli-poster.webp"]'))
      .or(stage.getByText("Não foi possível carregar o Oli em 3D")),
  ).toBeVisible({ timeout: 15_000 });
  const box = await stage.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(230);
  await expect(page.getByRole("heading", { name: "Oliveira's" })).toBeVisible();
});

test("esqueci minha senha: mensagem genérica para e-mail existente ou não", async ({ page }) => {
  const known = uniqueEmail("reset");
  await signUp(page, known);
  await page.context().clearCookies();

  for (const email of [known, uniqueEmail("naoexiste")]) {
    await page.goto("/login");
    await page.getByRole("link", { name: "Esqueci minha senha" }).click();
    await expect(page).toHaveURL(/\/esqueci-senha$/);
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "Enviar link" }).click();
    await expect(page.getByRole("status")).toHaveText(GENERIC);
  }
});

test("redefinir senha: sem sessão volta ao login com aviso", async ({ page }) => {
  await page.goto("/redefinir-senha");
  await expect(page).toHaveURL(/\/login\?erro=sessao$/);
  await expect(page.getByRole("status").filter({ hasText: "link de redefinição" })).toBeVisible();
});

test("callback: link inválido volta ao login com mensagem; `next` malicioso não sai do app", async ({ page, baseURL }) => {
  for (const next of ["//evil.example", "https://evil.example", "/inicio", "/redefinir-senha"]) {
    await page.goto(`/auth/callback?code=invalido&next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/login\?erro=link$/);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    await expect(page.getByRole("status").filter({ hasText: "inválido ou expirou" })).toBeVisible();
  }
  // Sem código nenhum, o mesmo.
  await page.goto("/auth/callback?next=//evil.example");
  await expect(page).toHaveURL(/\/login\?erro=link$/);
});

test("redefinir senha: validações, nova senha e login com ela", async ({ page }) => {
  const email = uniqueEmail("nova");
  const NOVA = "OutraSenha#2027";
  await signUp(page, email);

  await page.goto("/redefinir-senha");
  await page.getByLabel("Nova senha", { exact: true }).fill("curta");
  await page.getByLabel("Confirmar nova senha").fill("curta");
  // minLength do navegador barra antes do servidor; remove para testar a validação do servidor.
  await page.getByLabel("Nova senha", { exact: true }).evaluate((el: HTMLInputElement) => el.removeAttribute("minlength"));
  await page.getByLabel("Confirmar nova senha").evaluate((el: HTMLInputElement) => el.removeAttribute("minlength"));
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  await expect(page.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();

  await page.getByLabel("Nova senha", { exact: true }).fill(NOVA);
  await page.getByLabel("Confirmar nova senha").fill(NOVA + "x");
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  await expect(page.getByText("As senhas não conferem.")).toBeVisible();

  // useActionState limpa os campos após cada envio: preenche os dois de novo.
  await page.getByLabel("Nova senha", { exact: true }).fill(NOVA);
  await page.getByLabel("Confirmar nova senha").fill(NOVA);
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  await expect(page).toHaveURL(/\/(inicio|bem-vindo)$/);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();

  // Após o erro o formulário foi limpo: e-mail e senha de novo.
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(NOVA);
  await page.locator("form").getByRole("button", { name: "Entrar", exact: true }).click();
  // Conta recém-criada ainda não tem família: o Início leva ao /bem-vindo. Qualquer um dos dois prova que entrou.
  await expect(page).toHaveURL(/\/(inicio|bem-vindo)$/);
});
