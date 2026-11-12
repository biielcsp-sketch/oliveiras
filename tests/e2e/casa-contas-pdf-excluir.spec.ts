import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";
import { mod11Bancario, toLinhaDigitavel } from "../../src/lib/financas/documentos/boleto";

/**
 * Casa > Contas: envio de PDF/foto pelo mesmo fluxo das Finanças (conferir antes de gravar) e exclusão
 * de conta fixa com confirmação. Excluir apaga a conta e os pagamentos dela; NUNCA o extrato nem os
 * documentos (só perdem o vínculo). Família comum: sem leitura por IA, a conferência é à mão.
 */

const MES = "2026-12";
const DOC_URL = /\/financas\/documentos\/([0-9a-f-]{36})\?origem=casa&mes=2026-12$/;

function pdf(tag: string) {
  return { name: "documento.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`) };
}

function boleto(cents: string, livre: string) {
  const factor = 1000 + Math.round((Date.UTC(2026, 11, 10) - Date.UTC(2025, 1, 22)) / 86_400_000);
  const head = "3419";
  const rest = `${factor}${cents.padStart(10, "0")}${livre}`;
  return toLinhaDigitavel(head + mod11Bancario(head + rest) + rest)!;
}

async function uploadFromCasa(page: Page, tag: string) {
  await page.goto(`/casa/contas?mes=${MES}`);
  const box = page.getByRole("region", { name: "Ler PDF ou foto" });
  await box.getByLabel("PDF", { exact: true }).setInputFiles(pdf(tag));
  await expect(page).toHaveURL(DOC_URL, { timeout: 45_000 });
  await page.getByRole("radio", { name: "Boleto" }).click();
}

/** A conta mais recente com esse nome: o retry cria outra família, então `.single()` por nome pegaria duas linhas. */
async function latestBill<T>(admin: ReturnType<typeof adminClient>, name: string, cols: string): Promise<T> {
  const { data, error } = await admin.from("fin_bills").select(cols).eq("name", name).order("created_at", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`conta "${name}" não encontrada`);
  return data as unknown as T;
}

test("Casa > Contas: enviar boleto (liga à conta e cria conta da casa) e excluir conta com confirmação", async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  const admin = adminClient();
  await signUp(page, uniqueEmail("casa-pdf"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/financas/contas/nova");
  await page.getByLabel("Nome", { exact: true }).fill("Conta Teste");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/financas\/contas$/);

  await test.step("conta da casa Condomínio criada pela Casa", async () => {
    await page.goto("/financas/contas-fixas/nova?casa=1");
    await page.getByLabel("Nome").fill("Condomínio");
    await page.getByLabel("Valor esperado (R$)").fill("450,00");
    await page.getByLabel("Vence todo dia").fill("10");
    await page.getByRole("button", { name: "Criar conta fixa" }).click();
    await expect(page).toHaveURL(/\/casa\/contas$/);
  });

  await test.step("enviar boleto pela Casa: liga ao Condomínio e volta para Casa > Contas (mês mantido)", async () => {
    await uploadFromCasa(page, "boleto-condominio");
    await page.getByLabel("Beneficiário").fill("Condomínio Edifício");
    await page.getByLabel("Valor (R$)").fill("187,90");
    await page.getByLabel("Vencimento").fill("2026-12-10");
    await page.getByLabel("Linha digitável").fill(boleto("18790", "1091234567812345678955555"));
    await page.getByLabel("Conta fixa").selectOption({ label: "Condomínio" });
    await page.getByRole("button", { name: "Confirmar conta fixa" }).click();
    await expect(page).toHaveURL(new RegExp(`/casa/contas\\?mes=${MES}$`));
    await expect(page.getByTestId("conta-casa").filter({ hasText: "Condomínio" }).getByRole("link", { name: "boleto (PDF)" })).toBeVisible();
  });

  await test.step("enviar boleto pela Casa e criar conta nova: nasce como conta da casa", async () => {
    await uploadFromCasa(page, "boleto-gas");
    await page.getByLabel("Beneficiário").fill("Gás Encanado");
    await page.getByLabel("Valor (R$)").fill("199,00");
    await page.getByLabel("Vencimento").fill("2026-12-10");
    await page.getByLabel("Linha digitável").fill(boleto("19900", "1091234567812345678909999"));
    await page.getByLabel("Conta fixa").selectOption({ label: "+ Criar nova conta" });
    await page.getByLabel("Nome da conta").fill("Gás");
    await page.getByRole("button", { name: "Confirmar conta fixa" }).click();
    await expect(page).toHaveURL(new RegExp(`/casa/contas\\?mes=${MES}$`));
    await expect(page.getByTestId("conta-casa").filter({ hasText: "Gás" })).toBeVisible();
    expect(await latestBill<{ is_home: boolean }>(admin, "Gás", "is_home")).toEqual({ is_home: true });
  });

  await test.step("descartar na conferência volta para a Casa; origem inválida não vira redirecionamento", async () => {
    await uploadFromCasa(page, "descartar");
    await page.getByRole("button", { name: "Descartar este documento" }).click();
    await expect(page).toHaveURL(new RegExp(`/casa/contas\\?mes=${MES}$`));
    await uploadFromCasa(page, "origem-falsa");
    const url = new URL(page.url());
    url.searchParams.set("origem", "https://exemplo.com");
    await page.goto(url.toString());
    await page.getByRole("button", { name: "Descartar este documento" }).click();
    await expect(page).toHaveURL(/\/financas\/documentos$/);
  });

  let billId = "";
  let householdId = "";
  let docId = "";
  let txId = "";
  await test.step("preparar: pagamento do mês e lançamento do extrato", async () => {
    await page.goto(`/casa/contas?mes=${MES}`);
    const row = page.getByTestId("conta-casa").filter({ hasText: "Condomínio" });
    await row.getByRole("link", { name: "Marcar paga" }).click();
    await page.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(page).toHaveURL(/\/financas\/contas-fixas\?mes=/);
    const bill = await latestBill<{ id: string; household_id: string }>(admin, "Condomínio", "id, household_id");
    billId = bill.id;
    householdId = bill.household_id;
    const { data: acc } = await admin.from("fin_accounts").select("id").eq("household_id", householdId).single();
    const { data: tx, error } = await admin
      .from("fin_transactions")
      .insert({ household_id: householdId, account_id: acc!.id, date: "2026-12-10", description: "PAG CONDOMINIO", amount: -187.9, source: "manual" })
      .select("id")
      .single();
    expect(error).toBeNull();
    txId = tx!.id;
    const { data: doc } = await admin.from("fin_documents").select("id").eq("bill_id", billId).single();
    docId = doc!.id;
    const { count } = await admin.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("bill_id", billId);
    expect(count).toBe(1);
  });

  await test.step("confirmação mostra o que será apagado; Cancelar não apaga nada", async () => {
    await page.goto(`/casa/contas?mes=${MES}`);
    await page.getByRole("link", { name: "Excluir Condomínio" }).click();
    await expect(page).toHaveURL(new RegExp(`/financas/contas-fixas/${billId}/excluir\\?voltar=casa&mes=${MES}$`));
    await expect(page.getByText("1 pagamento registrado")).toBeVisible();
    await expect(page.getByText("1 documento fica guardado em Documentos, sem vínculo com a conta.")).toBeVisible();
    await expect(page.getByText("Os lançamentos do extrato não são apagados.")).toBeVisible();
    await page.getByRole("link", { name: "Cancelar" }).click();
    await expect(page).toHaveURL(new RegExp(`/casa/contas\\?mes=${MES}$`));
    const { count } = await admin.from("fin_bills").select("id", { count: "exact", head: true }).eq("id", billId);
    expect(count).toBe(1);
  });

  await test.step("excluir: conta e pagamento somem; documento e extrato ficam", async () => {
    await page.getByRole("link", { name: "Excluir Condomínio" }).click();
    await page.getByRole("button", { name: "Excluir conta e pagamentos" }).click();
    await expect(page).toHaveURL(new RegExp(`/casa/contas\\?mes=${MES}$`));
    await expect(page.getByTestId("conta-casa").filter({ hasText: "Condomínio" })).toHaveCount(0);
    await page.goto("/financas/contas-fixas");
    await expect(page.getByRole("link", { name: "Condomínio", exact: true })).toHaveCount(0);

    expect((await admin.from("fin_bills").select("id", { count: "exact", head: true }).eq("id", billId)).count).toBe(0);
    expect((await admin.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("bill_id", billId)).count).toBe(0);
    const { data: doc } = await admin.from("fin_documents").select("bill_id, status").eq("id", docId).single();
    expect(doc).toEqual({ bill_id: null, status: "confirmado" });
    expect((await admin.from("fin_transactions").select("id", { count: "exact", head: true }).eq("id", txId)).count).toBe(1);
    await page.goto("/financas/documentos");
    await expect(page.getByText("Condomínio Edifício").first()).toBeVisible();
  });

  await test.step("regressão: conta já apagada por fora, excluir avisa e NÃO redireciona como sucesso", async () => {
    await page.goto(`/casa/contas?mes=${MES}`);
    await page.getByRole("link", { name: "Excluir Gás" }).click();
    await expect(page).toHaveURL(/\/excluir\?voltar=casa/);
    const confirmUrl = page.url();
    const gas = await latestBill<{ id: string }>(admin, "Gás", "id");
    const { error } = await admin.from("fin_bills").delete().eq("id", gas.id);
    expect(error).toBeNull();
    await page.getByRole("button", { name: "Excluir conta e pagamentos" }).click();
    // `p[role=alert]`: o anunciador de rota do Next também é role="alert" (getByRole("alert") pegaria os dois).
    await expect(page.locator("p[role=alert]")).toContainText("A conta não foi encontrada");
    await expect(page).toHaveURL(confirmUrl);
    // A página de confirmação de conta inexistente é 404 (requisição direta: uma navegação 404 vira erro no console).
    expect((await page.request.get(confirmUrl)).status()).toBe(404);
  });

  await test.step("pela tela da conta fixa (Finanças)", async () => {
    await page.goto("/financas/contas-fixas/nova");
    await page.getByLabel("Nome").fill("Internet");
    await page.getByLabel("Valor esperado (R$)").fill("100,00");
    await page.getByLabel("Vence todo dia").fill("5");
    await page.getByRole("button", { name: "Criar conta fixa" }).click();
    await expect(page).toHaveURL(/\/financas\/contas-fixas$/);
    await page.getByRole("link", { name: "Internet", exact: true }).click();
    await page.getByRole("link", { name: "Excluir conta fixa" }).click();
    await expect(page).toHaveURL(/\/excluir$/);
    await page.getByRole("button", { name: "Excluir conta e pagamentos" }).click();
    await expect(page).toHaveURL(/\/financas\/contas-fixas$/);
    expect((await admin.from("fin_bills").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("name", "Internet")).count).toBe(0);
  });

  expect(problems).toEqual([]);
});
