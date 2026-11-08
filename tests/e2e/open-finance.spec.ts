import { expect, test, type Page } from "@playwright/test";
import { E2E_HOUSEHOLD_ID } from "../../playwright.config";
import { createFamilyWithId } from "./admin";
import { PASSWORD, signUp, uniqueEmail, watchConsole } from "./helpers";

const ITEM = "11111111-1111-4111-8111-111111111111";
const MOCK = "http://127.0.0.1:4010";
const text = async (page: Page) => (await page.locator("main").innerText()).replace(/\s/g, " ");

async function syncAndExpect(page: Page, expected: string) {
  await page.goto("/financas/open-finance");
  await page.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(page.getByRole("status")).toContainText(expected);
}

test("Open Finance: conectar item, vincular contas e sincronizar sem duplicar", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await request.post(`${MOCK}/__scenario/1`);
  const { today, old } = await (await request.get(`${MOCK}/__today`)).json();
  const month = today.slice(0, 7);

  await test.step("família autorizada entra", async () => {
    const email = uniqueEmail("of");
    await createFamilyWithId(E2E_HOUSEHOLD_ID, email, PASSWORD);
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  // Fica aqui porque esta é a família com o id autorizado (OLI_HOUSEHOLD_ID cai no PLUGGY_HOUSEHOLD_ID).
  await test.step("Oli: família autorizada sem GEMINI_API_KEY → 503", async () => {
    const res = await page.request.post("/api/oli/token");
    expect(res.status()).toBe(503);
    expect(await res.json()).toEqual({ error: "Oli não configurado." });
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  await test.step("conecta o item (recusa id inexistente)", async () => {
    await page.goto("/financas/open-finance");
    await page.getByLabel(/Id do item/).fill("aaaaaaaa-0000-4000-8000-000000000000");
    await page.getByRole("button", { name: "Conectar" }).click();
    await expect(page.getByText("Item não encontrado na Pluggy")).toBeVisible();

    await page.getByLabel(/Id do item/).fill(ITEM);
    await page.getByRole("button", { name: "Conectar" }).click();
    await expect(page.getByText("Banco Teste")).toBeVisible();
    await expect.poll(() => text(page)).toContain("Conta Teste •••• 45-6");
    expect(await text(page)).toContain("-R$ 65,90"); // dívida do cartão em negativo
  });

  await test.step("vincula as duas contas como contas novas", async () => {
    for (const name of ["Conta Teste", "Cartão Teste"]) {
      await page.locator("li").filter({ hasText: name }).getByRole("button", { name: "Vincular" }).click();
      await expect(page.locator("li").filter({ hasText: name })).toContainText(`Vinculada a ${name}`);
    }
  });

  await test.step("primeira sincronização e repetição idempotente", async () => {
    // Ao abrir Finanças a sincronização automática também roda; as duas juntas não podem duplicar.
    await syncAndExpect(page, "Sincronizado");
    await syncAndExpect(page, "0 novos, 0 atualizados, 0 removidos");

    await page.goto(`/financas/lancamentos?mes=${month}`);
    const t = await text(page);
    expect(t).toContain("5 lançamentos");
    expect(t.match(/SALARIO EMPRESA/g)).toHaveLength(1);
    expect(t).toContain("SALARIO EMPRESA");
    expect(t).toMatch(/IFOOD \*LOJA.*-R\$ 45,90/); // compra no cartão vira saída
    expect(t).toMatch(/MERCADO PENDENTE.*-R\$ 120,00/);

    // Regressão: a primeira leitura trazia só 60 dias, apesar do início em 90 dias atrás.
    await page.goto(`/financas/lancamentos?mes=${old.slice(0, 7)}`);
    expect(await text(page)).toContain("ALUGUEL ANTIGO");
  });

  // Regressão: o saldo da conta vinculada era saldo inicial 0 + lançamentos importados,
  // e não batia com o banco.
  await test.step("saldo das contas vinculadas bate com o banco sem ajuste manual", async () => {
    await page.goto("/financas/contas");
    const conta = page.locator("li").filter({ hasText: "Conta Teste" });
    await expect(conta).toContainText("R$ 4.864,50");
    await expect(conta).not.toContainText("Banco informa");
    const cartao = page.locator("li").filter({ hasText: "Cartão Teste" });
    await expect(cartao).toContainText("-R$ 65,90");
    await expect(cartao).not.toContainText("Banco informa");
  });

  await test.step("dia seguinte: pendente vira lançado, fatura reapresentada, item removido", async () => {
    await request.post(`${MOCK}/__scenario/2`);
    await syncAndExpect(page, "2 novos, 1 atualizados, 2 removidos");
    await page.goto(`/financas/lancamentos?mes=${month}`);
    const t = await text(page);
    expect(t).toMatch(/MERCADO.*-R\$ 125,40/);
    expect(t).not.toContain("MERCADO PENDENTE");
    expect(t).not.toContain("PADARIA");
    expect(t).not.toContain("UBER *TRIP");
    expect(t).toContain("UBER TRIP SP");
    expect(t).toContain("FARMACIA");
  });

  await test.step("autorização vencida: leitura vazia não apaga nada e avisa", async () => {
    await request.post(`${MOCK}/__scenario/3`);
    await page.goto("/financas/open-finance");
    await page.getByRole("button", { name: "Sincronizar agora" }).click();
    await expect(page.getByText(/Autorização vencida/).first()).toBeVisible();
    await page.goto(`/financas/lancamentos?mes=${month}`);
    const t = await text(page);
    expect(t).toContain("5 lançamentos");
    expect(t).toContain("FARMACIA");
    await request.post(`${MOCK}/__scenario/2`);
  });

  await test.step("depois das mudanças do dia seguinte, o saldo continua batendo", async () => {
    await page.goto("/financas/contas");
    const conta = page.locator("li").filter({ hasText: "Conta Teste" });
    await expect(conta).toContainText("R$ 4.864,50");
    await expect(conta).not.toContainText("Banco informa");
  });

  await test.step("lançamento manual entre sincronizações: botão ajusta o saldo inicial", async () => {
    await page.goto("/financas/lancamentos/novo");
    await page.getByLabel("Valor (R$)").fill("10,00");
    await page.getByLabel("Data", { exact: true }).fill(today);
    await page.getByLabel("Descrição", { exact: true }).fill("Ajuste manual");
    await page.locator('select[name="account_id"]').selectOption({ label: "Conta Teste" });
    await page.getByRole("button", { name: "Lançar" }).click();
    await expect(page.getByText("Ajuste manual")).toBeVisible();
    await page.goto("/financas/contas");
    await expect(page.locator("li").filter({ hasText: "Conta Teste" })).toContainText("Banco informa R$ 4.864,50");
    await page.getByRole("link", { name: /Conta Teste/ }).click();
    await page.getByRole("button", { name: "Ajustar saldo inicial para bater com o banco" }).click();
    await expect(page.getByText("Saldo atual: R$ 4.864,50")).toBeVisible();
  });

  await test.step("outra família não usa as credenciais da Pluggy", async () => {
    const other = await (await browser.newContext()).newPage();
    await signUp(other, uniqueEmail("x"));
    await other.getByLabel("Seu nome").fill("Intruso");
    await other.locator("form").getByRole("button", { name: "Criar família" }).click();
    // Espera o redirecionamento do cadastro terminar; senão ele sobrescreve a navegação seguinte.
    await expect(other).toHaveURL(/\/inicio$/);
    await other.goto("/financas/open-finance");
    await expect(other.getByText("esta família ainda não foi autorizada")).toBeVisible();
    await expect(other.getByLabel(/Id do item/)).toHaveCount(0);
  });

  await request.post(`${MOCK}/__scenario/1`);
  expect(problems, "erros de console/CSP").toEqual([]);
});
