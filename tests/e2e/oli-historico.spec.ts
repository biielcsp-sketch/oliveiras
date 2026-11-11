import { expect, test } from "@playwright/test";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

// Não há mock do Gemini Live neste projeto (o token do Oli exige GEMINI_API_KEY e a família autorizada),
// então a conversa é preparada direto no banco local; o que se testa é a camada do app:
// leitura no servidor, exibição em "Ver conversa" e "Limpar conversa".
test("Oli: histórico persiste ao recarregar, é privado por pessoa e pode ser limpo", async ({ page, browser }) => {
  const problems = watchConsole(page);
  const email = uniqueEmail("oli-hist");
  await signUp(page, email);
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const uid = users.users.find((u) => u.email === email)!.id;
  const { data: link } = await admin.from("household_users").select("household_id").eq("user_id", uid).single();
  const base = Date.now() - 60_000;
  const { error } = await admin.from("oli_messages").insert([
    { household_id: link!.household_id, user_id: uid, role: "user", content: "Marca dentista para sexta", created_at: new Date(base).toISOString() },
    { household_id: link!.household_id, user_id: uid, role: "model", content: "Pode deixar, que horas?", created_at: new Date(base + 1000).toISOString() },
  ]);
  expect(error).toBeNull();

  await test.step("recarregar: a conversa anterior já está em Ver conversa, em ordem", async () => {
    await page.reload();
    await page.getByRole("button", { name: "Ver conversa" }).click();
    const log = page.locator("#oli-conversa");
    await expect(log.getByText("Marca dentista para sexta")).toBeVisible();
    await expect(log.getByText("Pode deixar, que horas?")).toBeVisible();
    const texts = await log.locator("p").allInnerTexts();
    expect(texts.indexOf("Marca dentista para sexta")).toBeLessThan(texts.indexOf("Pode deixar, que horas?"));
  });

  await test.step("outra pessoa não vê a conversa", async () => {
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await signUp(other, uniqueEmail("oli-hist-b"));
    await other.getByLabel("Seu nome").fill("Outra");
    await other.locator("form").getByRole("button", { name: "Criar família" }).click();
    await expect(other).toHaveURL(/\/inicio$/);
    await other.getByRole("button", { name: "Ver conversa" }).click();
    await expect(other.getByText("Marca dentista para sexta")).toHaveCount(0);
    await ctx.close();
  });

  await test.step("Limpar conversa: pede um segundo toque, zera a tela e o banco", async () => {
    await page.getByRole("button", { name: "Limpar conversa" }).click();
    await expect(page.getByText("Marca dentista para sexta")).toBeVisible(); // ainda não apagou
    await page.getByRole("button", { name: "Toque de novo para apagar" }).click();
    await expect(page.getByText("Marca dentista para sexta")).toHaveCount(0);
    await expect(page.getByText(/As falas aparecem aqui/)).toBeVisible();
    await expect.poll(async () => (await admin.from("oli_messages").select("id").eq("user_id", uid)).data?.length).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "Ver conversa" }).click();
    await expect(page.getByText(/As falas aparecem aqui/)).toBeVisible();
  });

  expect(problems).toEqual([]);
});
