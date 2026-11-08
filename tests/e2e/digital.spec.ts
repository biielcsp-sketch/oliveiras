import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, signUp, uniqueEmail } from "./helpers";

const NOT_REGISTERED = "Esta digital não está cadastrada. Entre com a senha e ative em Família.";

/** Autenticador de plataforma simulado (como a digital do celular), via CDP do Chromium. */
async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** Coleta só violações de CSP (respostas 4xx esperadas do Auth também viram erro de console). */
function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

async function signInWithPassword(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

async function signOut(page: Page) {
  await page.goto("/familia");
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test("digital: sem chave cadastrada no servidor, não entra e orienta a usar a senha", async ({ page }) => {
  const csp = watchCsp(page);
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);

  // O aparelho tem uma credencial para este site que o servidor não conhece
  // (ex.: chave removida em outro aparelho ou banco reiniciado).
  await page.goto("/login");
  await page.evaluate(async () => {
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: "localhost", name: "Oliveira's" },
        // Mesmo formato do Supabase: user handle = UUID do usuário em texto.
        user: { id: new TextEncoder().encode(crypto.randomUUID()), name: "orfa", displayName: "orfa" },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error("sem credencial");
  });
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);

  await page.getByRole("button", { name: "Entrar com digital" }).click();
  await expect(page.getByText(NOT_REGISTERED)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  expect(csp).toEqual([]);
});

test("digital: ativar em Família, entrar com digital, remover e a senha continua valendo", async ({ page }) => {
  const csp = watchCsp(page);
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
  const email = uniqueEmail("digital");

  await signUp(page, email);
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  // (b) ativa neste aparelho e aparece na lista
  await page.goto("/familia");
  const list = page.getByRole("list", { name: "Digitais cadastradas" });
  await page.getByRole("button", { name: "Ativar neste aparelho" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("Criada em");
  expect((await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials).toHaveLength(1);

  // Ativar de novo no mesmo aparelho é recusado com mensagem clara
  await page.getByRole("button", { name: "Ativar neste aparelho" }).click();
  await expect(page.getByText("Este aparelho já está cadastrado.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  // Renomear
  await list.getByRole("button", { name: /^Renomear/ }).click();
  await page.getByLabel("Nome da digital").fill("Celular do Gabriel");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(list).toContainText("Celular do Gabriel");

  // Sai e entra com a digital, sem senha
  await signOut(page);
  await page.getByRole("button", { name: "Entrar com digital" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/familia");
  await expect(list).toContainText("último uso");

  // (c) remove (com confirmação na tela) e a digital deixa de entrar
  await list.getByRole("button", { name: "Remover Celular do Gabriel" }).click();
  await page.getByRole("button", { name: "Confirmar remoção" }).click();
  await expect(list).toHaveCount(0);
  await signOut(page);
  await page.getByRole("button", { name: "Entrar com digital" }).click();
  await expect(page.getByText(NOT_REGISTERED)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // (d) a senha continua funcionando
  await signInWithPassword(page, email);
  expect(csp).toEqual([]);
});
