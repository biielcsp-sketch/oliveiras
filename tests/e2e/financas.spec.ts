import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

const brl = (text: string) => text.replace(/\s/g, " ");

async function expectText(page: Page, text: string) {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
}

test("finanças: contas, lançamento manual, importação OFX/CSV sem duplicar e resumo", async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);

  await test.step("cria família", async () => {
    await signUp(page, uniqueEmail("fin"));
    await page.getByLabel("Seu nome").fill("Gabriel");
    await page.locator("form").getByRole("button", { name: "Criar família" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  await test.step("cria conta corrente e cartão", async () => {
    await page.goto("/financas");
    await page.getByRole("link", { name: "Nova conta" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("Conta Teste");
    await page.getByLabel("Saldo inicial (R$)").fill("1.000,00");
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/financas\/contas$/);

    await page.getByRole("link", { name: "Nova conta" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("Cartão Teste");
    await page.locator('select[name="kind"]').selectOption("cartao");
    await page.getByLabel("Limite (R$)").fill("5.000");
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page.getByText("Cartão Teste")).toBeVisible();
  });

  await test.step("lança saída manual", async () => {
    await page.goto("/financas/lancamentos/novo");
    await page.getByLabel("Valor (R$)").fill("150,50");
    await page.getByLabel("Data", { exact: true }).fill("2026-11-07");
    await page.getByLabel("Descrição", { exact: true }).fill("Mercado da semana");
    await page.locator('select[name="account_id"]').selectOption({ label: "Conta Teste" });
    await page.locator('select[name="category_id"]').selectOption({ label: "Mercado" });
    await page.getByRole("button", { name: "Lançar" }).click();
    await expect(page).toHaveURL(/\/financas\/lancamentos\?mes=2026-11$/);
    await expect(page.getByText("Mercado da semana")).toBeVisible();
  });

  await test.step("importa OFX com regra de fatura e não duplica ao reimportar", async () => {
    for (const round of [1, 2]) {
      await page.goto("/financas/importar");
      await page.locator('select[name="account_id"]').selectOption({ label: "Conta Teste" });
      await page.getByLabel("Arquivo OFX ou CSV do banco").setInputFiles("tests/fixtures/extrato.ofx");
      await page.getByRole("button", { name: "Pré-visualizar" }).click();
      if (round === 1) {
        await expectText(page, "3 novos");
        await expect(page.getByText("Pagamento de fatura", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Importar 3 lançamentos" }).click();
        await expect(page.getByRole("status")).toContainText("3 lançamentos importados");
      } else {
        await expectText(page, "0 novos, 3 já importados");
        await expect(page.getByRole("button", { name: "Importar 0 lançamentos" })).toBeDisabled();
      }
    }
  });

  await test.step("importa CSV de fatura com sinal invertido sugerido", async () => {
    await page.goto("/financas/importar");
    await page.locator('select[name="account_id"]').selectOption({ label: "Cartão Teste" });
    await page.getByLabel("Arquivo OFX ou CSV do banco").setInputFiles("tests/fixtures/fatura-cartao.csv");
    await page.getByRole("button", { name: "Pré-visualizar" }).click();
    await expect(page.getByLabel(/Inverter sinais/)).toBeChecked();
    await expectText(page, "4 novos");
    await page.getByRole("button", { name: "Importar 4 lançamentos" }).click();
    await expect(page.getByRole("status")).toContainText("4 lançamentos importados");
  });

  await test.step("resumo de novembro/2026 confere", async () => {
    await page.goto("/financas?mes=2026-11");
    const main = page.locator("main");
    // Conta: 1000 − 150,50 − 152,30 + 3500 − 89,90 = 4.107,30
    await expect(main).toContainText("R$ 4.107,30", { useInnerText: true });
    // Cartão: −45,90 −45,90 −23,10 +10 = −104,90
    expect(brl(await main.innerText())).toContain("-R$ 104,90");
    // Entradas 3.500 + estorno 10; saídas 150,50 + 152,30 + 91,80 + 23,10; fatura fora dos totais
    expect(brl(await main.innerText())).toContain("R$ 3.510,00");
    expect(brl(await main.innerText())).toContain("-R$ 417,70");
    expect(brl(await main.innerText())).toContain("R$ 3.092,30");
  });

  await test.step("edita e exclui lançamento", async () => {
    await page.goto("/financas/lancamentos?mes=2026-11&q=semana");
    await page.getByText("Mercado da semana").click();
    await page.getByLabel("Valor (R$)").fill("160,00");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.locator("main")).toContainText("160,00");
    await page.getByText("Mercado da semana").click();
    await page.getByRole("button", { name: "Excluir lançamento" }).click();
    await expect(page).toHaveURL(/\/financas\/lancamentos$/);
    await page.goto("/financas/lancamentos?mes=2026-11&q=semana");
    await expect(page.getByText("Nenhum lançamento encontrado")).toBeVisible();
  });

  expect(problems, "erros de console/CSP").toEqual([]);
});
