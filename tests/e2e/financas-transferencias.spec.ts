// Transferência entre contas da família aparece como UM par na aba Transferências e sai dos totais de Gastos;
// valor igual sem indício (compra x Pix recebido) não vira par. Nomes fictícios.
import { expect, test } from "@playwright/test";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

const brl = (text: string) => text.replace(/\s/g, " ");

test("finanças: aba Transferências junta Pix entre contas do casal e separa dos gastos", async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  const admin = adminClient();
  const stamp = Date.now();
  const contaA = `Conta A ${stamp}`;
  const contaB = `Conta B ${stamp}`;
  const today = new Date().toISOString().slice(0, 10);
  const mes = today.slice(0, 7);

  await test.step("cria família e duas contas", async () => {
    await signUp(page, uniqueEmail("fintransf"));
    await page.getByLabel("Seu nome").fill("Fulano");
    await page.locator("form").getByRole("button", { name: "Criar família" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    for (const name of [contaA, contaB]) {
      await page.goto("/financas/contas/nova");
      await page.getByLabel("Nome", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Criar conta" }).click();
      await expect(page).toHaveURL(/\/financas\/contas$/);
    }
  });

  await test.step("prepara Pix entre as contas e uma compra de mesmo valor (Supabase local)", async () => {
    const { data: accs } = await admin.from("fin_accounts").select("id, name, household_id").in("name", [contaA, contaB]);
    const a = accs!.find((x) => x.name === contaA)!;
    const b = accs!.find((x) => x.name === contaB)!;
    const base = { household_id: a.household_id, date: today, source: "manual" };
    const { error } = await admin.from("fin_transactions").insert([
      { ...base, account_id: a.id, description: "PIX ENVIADO Fulano", amount: -250 },
      { ...base, account_id: b.id, description: "Pix recebido", amount: 250 },
      { ...base, account_id: a.id, description: "FARMACIA BOA", amount: -10 },
      { ...base, account_id: b.id, description: "Pix recebido de terceiro", amount: 10 },
    ]);
    expect(error).toBeNull();
  });

  await test.step("Procurar pares junta só a transferência", async () => {
    await page.goto(`/financas/lancamentos?mes=${mes}&tipo=transferencias`);
    await page.getByRole("button", { name: "Procurar pares" }).click();
    await expect(page.getByRole("status")).toContainText("1 par juntado.");
    const pares = page.getByRole("list", { name: "Transferências entre contas" });
    await expect(pares.getByRole("listitem")).toHaveCount(1);
    await expect(pares).toContainText(contaA);
    await expect(pares).toContainText(contaB);
    expect(brl(await pares.innerText())).toContain("R$ 250,00");
  });

  await test.step("Gastos não mostram as pernas do par e os totais ficam sem elas", async () => {
    await page.goto(`/financas/lancamentos?mes=${mes}`);
    const main = page.locator("main");
    await expect(main.getByText("PIX ENVIADO Fulano")).toHaveCount(0);
    await expect(main.getByText("FARMACIA BOA")).toBeVisible();
    expect(brl(await main.innerText())).toContain("2 lançamentos");
  });

  await test.step("Separar desfaz o par", async () => {
    await page.goto(`/financas/lancamentos?mes=${mes}&tipo=transferencias`);
    await page.getByRole("button", { name: "Separar" }).click();
    await expect(page.getByRole("list", { name: "Transferências entre contas" })).toHaveCount(0);
  });

  expect(problems).toEqual([]);
});
