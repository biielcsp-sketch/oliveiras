import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

const text = async (page: Page) => (await page.locator("main").innerText()).replace(/\s/g, " ");

async function newAccount(page: Page, name: string, kind: string, extra: Record<string, string>) {
  await page.goto("/financas/contas/nova");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.locator('select[name="kind"]').selectOption(kind);
  for (const [label, value] of Object.entries(extra)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/financas\/contas$/);
}

async function importFile(page: Page, account: string, file: string) {
  await page.goto("/financas/importar");
  await page.locator('select[name="account_id"]').selectOption({ label: account });
  await page.getByLabel("Arquivo OFX ou CSV do banco").setInputFiles(file);
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await page.getByRole("button", { name: /^Importar \d+ lançamentos$/ }).click();
  await expect(page.getByRole("status")).toContainText("importados");
}

test("planejamento: orçamento, fatura do cartão, conta paga vinculada ao extrato e meta", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);

  await test.step("prepara família, contas e extratos", async () => {
    await signUp(page, uniqueEmail("plan"));
    await page.getByLabel("Seu nome").fill("Gabriel");
    await page.locator("form").getByRole("button", { name: "Criar família" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await newAccount(page, "Conta Teste", "corrente", { "Saldo inicial (R$)": "5.000,00" });
    await newAccount(page, "Cartão Teste", "cartao", { "Fecha dia": "3", "Vence dia": "10" });
    await newAccount(page, "Poupança Reserva", "poupanca", { "Saldo inicial (R$)": "12.000,00" });
    await importFile(page, "Conta Teste", "tests/fixtures/extrato.ofx");
    await importFile(page, "Cartão Teste", "tests/fixtures/fatura-cartao.csv");
  });

  await test.step("fatura do cartão por período de fechamento", async () => {
    // Fecha 3, vence 10: fatura de nov cobre 03/10–02/11 (2× iFood = 91,80) e já foi paga (+500 em 06/11)
    await page.goto("/financas/contas-a-pagar?mes=2026-11");
    const card = page.locator("li").filter({ hasText: "Cartão Teste" });
    await expect(card).toContainText("R$ 91,80");
    await expect(card).toContainText("Paga");
    // Fatura de dez: Uber 23,10. Crédito sem categoria (estorno +10, pagamento +500) não abate.
    await page.goto("/financas/contas-a-pagar?mes=2026-12");
    await expect(page.locator("li").filter({ hasText: "Cartão Teste" })).toContainText("R$ 23,10");
  });

  await test.step("regra nova categoriza lançamentos antigos", async () => {
    await page.goto("/financas/categorias");
    await page.getByLabel("Texto da regra").fill("pão de açúcar");
    await page.getByLabel("Categoria da regra").selectOption({ label: "Mercado" });
    await page.getByRole("button", { name: "Criar regra" }).click();
    await expect(page.getByText("“pão de açúcar”")).toBeVisible();
    await page.getByRole("button", { name: "Aplicar regras aos sem categoria" }).click();
    await expect(page.getByRole("status")).toContainText("1 lançamento categorizado.");
  });

  await test.step("orçamento padrão e ajuste de um mês", async () => {
    await page.goto("/financas/orcamento?mes=2026-11");
    await page.getByRole("button", { name: /Mercado/ }).click();
    await page.getByLabel("Orçamento de Mercado").fill("1.000");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => text(page)).toContain("R$ 152,30 / R$ 1.000,00");
    expect(await text(page)).toContain("Restam R$ 847,70");

    await page.goto("/financas/orcamento?mes=2026-12");
    await expect.poll(() => text(page)).toContain("R$ 0,00 / R$ 1.000,00");
    await page.getByRole("button", { name: /Mercado/ }).click();
    await page.getByLabel("Orçamento de Mercado").fill("500");
    await page.getByLabel("Vale para").selectOption("mes");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => text(page)).toContain("R$ 0,00 / R$ 500,00");
    expect(await text(page)).toContain("só este mês");

    await page.goto("/financas/orcamento?mes=2026-11");
    await expect.poll(() => text(page)).toContain("R$ 152,30 / R$ 1.000,00");
  });

  await test.step("conta a pagar marcada como paga com o lançamento do extrato", async () => {
    await page.goto("/financas/lancamentos/novo");
    await page.getByLabel("Valor (R$)").fill("1.790,00");
    await page.getByLabel("Data", { exact: true }).fill("2026-11-04");
    await page.getByLabel("Descrição", { exact: true }).fill("ALUGUEL NOV");
    await page.locator('select[name="account_id"]').selectOption({ label: "Conta Teste" });
    await page.getByRole("button", { name: "Lançar" }).click();
    await expect(page).toHaveURL(/lancamentos\?mes=2026-11/);

    await page.goto("/financas/contas-a-pagar/nova");
    await page.getByLabel("Nome", { exact: true }).fill("Aluguel");
    await page.getByLabel("Valor esperado (R$)").fill("1.800,00");
    await page.getByLabel("Vence todo dia").fill("5");
    await page.getByRole("button", { name: "Criar conta a pagar" }).click();

    await page.goto("/financas/contas-a-pagar?mes=2026-11");
    await page.locator("li").filter({ hasText: "Aluguel" }).getByRole("link", { name: "Marcar paga" }).click();
    await expect(page.getByRole("radio", { name: /ALUGUEL NOV/ })).toBeChecked();
    await page.getByRole("button", { name: "Confirmar pagamento" }).click();
    const row = page.locator("li").filter({ hasText: "Aluguel" });
    await expect(row).toContainText("paga em 04/11 (no extrato)");
    await expect(row).toContainText("R$ 1.790,00");

    // Desfazer devolve a conta para "a pagar"
    await row.getByRole("button", { name: "desfazer" }).click();
    await expect(page.locator("li").filter({ hasText: "Aluguel" }).getByRole("link", { name: "Marcar paga" })).toBeVisible();
  });

  await test.step("meta medida pelo saldo da conta", async () => {
    await page.goto("/financas/metas/nova");
    await page.getByLabel("Nome da meta").fill("Reserva de emergência");
    await page.getByLabel("Valor alvo (R$)").fill("30.000");
    await page.locator('select[name="account_id"]').selectOption({ label: "Poupança Reserva" });
    await page.getByRole("button", { name: "Criar meta" }).click();
    await expect(page).toHaveURL(/\/financas\/metas$/);
    await expect.poll(() => text(page)).toContain("R$ 12.000,00 de R$ 30.000,00");
    expect(await text(page)).toContain("40%");
  });

  await test.step("resumo mostra orçamento e o que falta pagar", async () => {
    await page.goto("/financas?mes=2026-11");
    const t = await text(page);
    expect(t).toContain("A pagar neste mês");
    expect(t).toMatch(/Aluguel.*R\$ 1\.800,00/);
    expect(t).toContain("R$ 152,30 de R$ 1.000,00");
  });

  expect(problems, "erros de console/CSP").toEqual([]);
});
