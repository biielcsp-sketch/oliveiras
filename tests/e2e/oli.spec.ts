import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

// A família autorizada sem GEMINI_API_KEY (→ 503) é testada em open-finance.spec.ts,
// que já cria a família com o id autorizado; fazer isso aqui disputaria o mesmo id em paralelo.

test("token do Oli: sem login → 401, sem cache", async ({ request }) => {
  const res = await request.post("/api/oli/token", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(await res.json()).toEqual({ error: "Faça login para conversar com o Oli." });
});

test("token do Oli: outra origem → 403", async ({ request }) => {
  const res = await request.post("/api/oli/token", { headers: { origin: "https://evil.example" }, maxRedirects: 0 });
  expect(res.status()).toBe(403);
});

test("tela do Oli (/assistente): esfera, controles e família não autorizada recebe 403", async ({ page }) => {
  const problems = watchConsole(page);
  await signUp(page, uniqueEmail("oli"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  await test.step("Início é o painel: saudação, sem o Oli", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Olá, Gabriel!");
    await expect(page.getByText("Que Deus abençoe seu dia!")).toBeVisible();
    await expect(page.getByTestId("oli-stage")).toHaveCount(0);
    // Sem contas nas Finanças: estado vazio no lugar do saldo
    await expect(page.getByText("Cadastre uma conta nas Finanças")).toBeVisible();
  });

  await test.step("esfera do Oli aparece em Repouso sem conectar", async () => {
    await page.goto("/assistente");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oli");
    const stage = page.getByTestId("oli-stage");
    await expect(stage).toBeVisible();
    await expect(stage.getByRole("img", { name: "Oli, o assistente da família" })).toBeVisible();
    await expect(stage.getByTestId("oli-sphere")).toHaveAttribute("data-state", "idle");
    await expect(stage.locator("canvas, img")).toHaveCount(0);
    await expect(page.getByTestId("oli-estado")).toHaveText("Repouso");
    await expect(page.getByRole("status").first()).toHaveText("Toque em Conversar para falar com o Oli");
    await expect(page.getByRole("button", { name: "Conversar" })).toBeVisible();
    await expect(page.getByPlaceholder("Ou digite aqui")).toBeVisible();
  });

  await test.step("conversa recolhível", async () => {
    const toggle = page.getByRole("button", { name: "Ver conversa" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByText("As falas aparecem aqui.")).toBeVisible();
    await page.getByRole("button", { name: "Ocultar conversa" }).click();
    await expect(page.getByText("As falas aparecem aqui.")).toHaveCount(0);
  });

  await test.step("worklet do microfone carrega sob a CSP do app", async () => {
    const loaded = await page.evaluate(async () => {
      const ctx = new AudioContext();
      try {
        await ctx.audioWorklet.addModule("/oli/pcm-capture.js");
        return "ok";
      } catch (e) {
        return String(e);
      } finally {
        await ctx.close();
      }
    });
    expect(loaded).toBe("ok");
  });

  // Até aqui: nenhum erro de JS nem violação de CSP.
  expect(problems).toEqual([]);

  await test.step("família não autorizada: token 403 e o Oli volta ao Repouso com aviso", async () => {
    const res = await page.request.post("/api/oli/token");
    expect(res.status()).toBe(403);
    await page.getByPlaceholder("Ou digite aqui").fill("Oi, Oli");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByRole("status").first()).toHaveText("O Oli ainda não está liberado para esta família.");
    await expect(page.getByTestId("oli-estado")).toHaveText("Repouso");
    await expect(page.getByRole("button", { name: "Conversar" })).toBeEnabled();
    // O único erro aceito é o 403 do próprio token no console do navegador.
    expect(problems.filter((p) => !/status of 403/.test(p))).toEqual([]);
  });

  await test.step("/assistente continua sendo a tela do Oli depois de recarregar", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/assistente$/);
    await expect(page.getByTestId("oli-stage")).toBeVisible();
  });
});

test("CSP e permissões para o Oli", async ({ request }) => {
  const res = await request.get("/login");
  const csp = res.headers()["content-security-policy"];
  const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!;
  expect(connect).toContain("wss://generativelanguage.googleapis.com");
  expect(res.headers()["permissions-policy"]).toContain("microphone=(self)");
});
