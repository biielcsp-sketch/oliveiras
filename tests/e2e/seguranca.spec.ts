import { expect, test } from "@playwright/test";

test("headers de segurança e CSP com nonce", async ({ page }) => {
  const res = await page.goto("/login");
  const h = res!.headers();
  const csp = h["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();

  // Todos os scripts da página levam o nonce da CSP
  const nonce = csp.match(/'nonce-([^']+)'/)![1];
  const scripts = await page.locator("script").evaluateAll((els) =>
    els.map((e) => (e as HTMLScriptElement).nonce),
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const n of scripts) expect(n).toBe(nonce);
});

test("nonce muda a cada requisição", async ({ request }) => {
  const get = async () => (await request.get("/login")).headers()["content-security-policy"];
  expect(await get()).not.toBe(await get());
});

test("o JavaScript roda sob a CSP (abas do login funcionam)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/login");
  await page.getByRole("button", { name: "Criar conta" }).first().click();
  await expect(page.getByLabel("Senha")).toHaveAttribute("autocomplete", "new-password");
  expect(errors).toEqual([]);
});
