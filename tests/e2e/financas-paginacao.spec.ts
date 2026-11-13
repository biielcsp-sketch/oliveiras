// Regressão: as telas de Finanças cortavam os lançamentos do mês em 1000 (max_rows do PostgREST) sem avisar.
// Com 1005 saídas de R$ 1,00 no mês, o total de saídas mostrava R$ 1.000,00 em vez de R$ 1.005,00, e
// "Aplicar regras aos sem categoria" categorizava só 1000.
import { expect, test } from "@playwright/test";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

const brl = (text: string) => text.replace(/\s/g, " ");
const MES = "2026-10";
const TOTAL = 1005;

test("finanças: mais de 1000 lançamentos somam todos e a regra categoriza todos (sem corte silencioso)", async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  const admin = adminClient();
  const accountName = `Conta Paginação ${Date.now()}`;

  await test.step("cria família e conta", async () => {
    await signUp(page, uniqueEmail("finpag"));
    await page.getByLabel("Seu nome").fill("Gabriel");
    await page.locator("form").getByRole("button", { name: "Criar família" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await page.goto("/financas/contas/nova");
    await page.getByLabel("Nome", { exact: true }).fill(accountName);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/financas\/contas$/);
  });

  await test.step(`prepara ${TOTAL} saídas de R$ 1,00 em ${MES} (Supabase local)`, async () => {
    const { data: acc, error } = await admin.from("fin_accounts").select("id, household_id").eq("name", accountName).single();
    expect(error).toBeNull();
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      household_id: acc!.household_id,
      account_id: acc!.id,
      date: `${MES}-${String((i % 28) + 1).padStart(2, "0")}`,
      description: `Compra ${i + 1}`,
      amount: -1,
      source: "manual",
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await admin.from("fin_transactions").insert(rows.slice(i, i + 500));
      expect(e).toBeNull();
    }
    const { count } = await admin
      .from("fin_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acc!.id);
    expect(count).toBe(TOTAL);
  });

  await test.step("Finanças mostra o total de saídas completo", async () => {
    await page.goto(`/financas?mes=${MES}`);
    const main = page.locator("main");
    // O card de Saídas e o resultado do mês (o saldo da conta, no topo, já era -R$ 1.005,00 antes da correção).
    const saidas = main.getByText("Saídas", { exact: true }).locator("..");
    await expect(saidas).toBeVisible();
    expect(brl(await saidas.innerText())).toContain("-R$ 1.005,00");
    const resultado = main.getByText("Resultado do mês", { exact: true }).locator("..");
    expect(brl(await resultado.innerText())).toContain("-R$ 1.005,00");
    expect(brl(await main.innerText())).not.toContain("-R$ 1.000,00");
    await expect(page.getByTestId("lista-incompleta")).toHaveCount(0);
  });

  await test.step("Lançamentos conta e soma os 1005", async () => {
    await page.goto(`/financas/lancamentos?mes=${MES}`);
    const text = brl(await page.locator("main").innerText());
    expect(text).toContain(`${TOTAL} lançamentos`);
    expect(text).toContain("saídas -R$ 1.005,00");
    await expect(page.getByTestId("lista-incompleta")).toHaveCount(0);
  });

  await test.step("regra nova categoriza os 1005 sem categoria e conta certo", async () => {
    await page.goto("/financas/categorias");
    await page.getByLabel("Texto da regra").fill("compra");
    await page.getByLabel("Categoria da regra").selectOption({ label: "Mercado" });
    await page.getByRole("button", { name: "Criar regra" }).click();
    await expect(page.getByText("“compra”")).toBeVisible();
    await page.getByRole("button", { name: "Aplicar regras aos sem categoria" }).click();
    await expect(page.getByRole("status")).toContainText(`${TOTAL} lançamentos categorizados.`, { timeout: 30_000 });
    await expect(page.getByRole("status")).not.toContainText("Ainda pode haver");
    const { data: acc } = await admin.from("fin_accounts").select("id").eq("name", accountName).single();
    const { count } = await admin
      .from("fin_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acc!.id)
      .is("category_id", null);
    expect(count).toBe(0);
  });

  expect(problems).toEqual([]);
});
