import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

/**
 * Simula o Chromium oferecendo a instalação: depois do load dispara um `beforeinstallprompt` falso
 * (prompt() registra a chamada; userChoice resolve "accepted").
 */
function fakeInstallPrompt(page: Page) {
  return page.addInitScript(() => {
    const w = window as unknown as { __prompted?: number };
    w.__prompted = 0;
    window.addEventListener("load", () => {
      setTimeout(() => {
        const ev = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string; platform: string }>;
        };
        ev.prompt = () => {
          w.__prompted = (w.__prompted ?? 0) + 1;
          return Promise.resolve();
        };
        ev.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
        window.dispatchEvent(ev);
      }, 300);
    });
  });
}

async function createFamily(page: Page, tag: string) {
  await signUp(page, uniqueEmail(tag));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

const card = (page: Page) => page.getByRole("dialog", { name: "Instalar o Oli" });

test("Android: card aparece, Instalar chama o prompt e Agora não esconde mesmo depois de recarregar", async ({ page }) => {
  const problems = watchConsole(page);
  await fakeInstallPrompt(page);
  await createFamily(page, "instalar");

  await test.step("aparece acima da barra inferior, sem roubar o foco", async () => {
    await expect(card(page)).toBeVisible({ timeout: 6000 });
    await expect(card(page)).toContainText("Abra direto da tela inicial, em tela cheia.");
    await expect(card(page).getByRole("img")).toHaveCount(0); // mini Oli decorativo (alt vazio)
    expect(await card(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);
    const cardBox = (await card(page).boundingBox())!;
    const navBox = (await page.getByRole("navigation", { name: "Principal" }).boundingBox())!;
    const oliBtn = (await page.getByRole("link", { name: "Oli, o assistente" }).boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(Math.min(navBox.y, oliBtn.y));
    for (const name of ["Instalar", "Agora não"]) {
      const b = (await card(page).getByRole("button", { name }).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });

  await test.step("Instalar abre o pedido do navegador e o card some", async () => {
    await card(page).getByRole("button", { name: "Instalar" }).click();
    await expect(card(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
  });

  await test.step("Agora não: some e não volta ao recarregar (7 dias)", async () => {
    await page.reload();
    await expect(card(page)).toBeVisible({ timeout: 6000 });
    await card(page).getByRole("button", { name: "Agora não" }).click();
    await expect(card(page)).toHaveCount(0);
    const until = Number(await page.evaluate(() => localStorage.getItem("oli-instalar-dispensado-ate")));
    expect(until - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    await page.reload();
    await page.waitForTimeout(3500);
    await expect(card(page)).toHaveCount(0);
  });

  await test.step("Esc também fecha", async () => {
    await page.evaluate(() => localStorage.removeItem("oli-instalar-dispensado-ate"));
    await page.reload();
    await expect(card(page)).toBeVisible({ timeout: 6000 });
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
  });

  expect(problems, "erros de console/CSP").toEqual([]);
});

test("manifest: app instala com o nome Oli e ícones do Oli", async ({ request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.name).toBe("Oli · Oliveira's");
  expect(m.short_name).toBe("Oli");
  expect(m.start_url).toBe("/inicio");
  for (const icon of m.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
  }
});

test("já instalado (standalone): o card não aparece", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q: string) =>
      q.includes("display-mode: standalone") ? ({ ...original(q), matches: true, media: q } as MediaQueryList) : original(q);
  });
  await fakeInstallPrompt(page);
  await createFamily(page, "instalado");
  await page.waitForTimeout(3500);
  await expect(card(page)).toHaveCount(0);
});

test.describe("iPhone Safari", () => {
  test.use({ userAgent: IPHONE_SAFARI_UA });

  test("mostra a instrução do Compartilhar e só o botão Entendi", async ({ page }) => {
    const problems = watchConsole(page);
    await createFamily(page, "instalar-ios");
    await expect(card(page)).toBeVisible({ timeout: 6000 });
    await expect(card(page)).toContainText("Toque em Compartilhar e depois em Adicionar à Tela de Início.");
    await expect(card(page).getByRole("button")).toHaveText(["Entendi"]);
    await card(page).getByRole("button", { name: "Entendi" }).click();
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(3500);
    await expect(card(page)).toHaveCount(0);
    expect(problems, "erros de console/CSP").toEqual([]);
  });
});
