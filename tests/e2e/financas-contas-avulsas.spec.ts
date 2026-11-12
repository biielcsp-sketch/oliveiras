import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";
import { mod11Bancario, toLinhaDigitavel } from "../../src/lib/financas/documentos/boleto";

/**
 * Conta avulsa (paga uma vez só): o boleto enviado por Casa > Contas NÃO vira conta fixa sozinho.
 * Na conferência o usuário escolhe "Conta avulsa (só esta vez)"; ela aparece em Casa > Contas e nas
 * Finanças (seção "Contas avulsas" do mês do vencimento), nunca entre as contas fixas, e é marcada paga
 * à mão ou pelo comprovante. Um lançamento que já pagou uma fixa não paga a avulsa.
 * Família comum: sem leitura por IA, a conferência é à mão (o Gemini simulado nem é chamado).
 */

const MES = "2026-12";
const DOC_URL = /\/financas\/documentos\/([0-9a-f-]{36})(\?.*)?$/;
const NOME = "Conserto do portão";

function pdf(tag: string) {
  return { name: "documento.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`) };
}

function boleto(cents: string, livre: string) {
  const factor = 1000 + Math.round((Date.UTC(2026, 11, 15) - Date.UTC(2025, 1, 22)) / 86_400_000);
  const head = "3419";
  const rest = `${factor}${cents.padStart(10, "0")}${livre}`;
  return toLinhaDigitavel(head + mod11Bancario(head + rest) + rest)!;
}
const LINHA = boleto("48000", "1091234567812345678977777");

async function upload(page: Page, from: string, tag: string) {
  await page.goto(from);
  const box = page.getByRole("region", { name: "Ler PDF ou foto" });
  // Escolher o PDF já envia para leitura.
  await box.getByLabel("PDF", { exact: true }).setInputFiles(pdf(tag));
  await expect(page).toHaveURL(DOC_URL, { timeout: 45_000 });
  return page.url().match(DOC_URL)![1];
}

test("Conta avulsa: boleto pela Casa vira avulsa, aparece em Casa e Finanças (fora das fixas) e é paga", async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  const admin = adminClient();
  await signUp(page, uniqueEmail("avulsa"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/financas/contas/nova");
  await page.getByLabel("Nome", { exact: true }).fill("Conta Teste");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/financas\/contas$/);
  await page.goto("/financas/contas-fixas/nova?casa=1");
  await page.getByLabel("Nome").fill("Condomínio");
  await page.getByLabel("Valor esperado (R$)").fill("450,00");
  await page.getByLabel("Vence todo dia").fill("10");
  await page.getByRole("button", { name: "Criar conta fixa" }).click();
  await expect(page).toHaveURL(/\/casa\/contas$/);

  let docId = "";
  await test.step("conferência: sem tipo não confirma (nem no servidor); escolhe Conta avulsa", async () => {
    docId = await upload(page, `/casa/contas?mes=${MES}`, "boleto-avulso");
    await page.getByRole("radio", { name: "Boleto" }).click();
    await page.getByLabel("Beneficiário").fill("Portões Silva Ltda");
    await page.getByLabel("Valor (R$)").fill("480,00");
    await page.getByLabel("Vencimento").fill("2026-12-15");
    await page.getByLabel("Linha digitável").fill(LINHA);
    // Nenhum tipo vem marcado: o boleto não vira conta fixa sozinho.
    await expect(page.getByRole("radio", { name: "Conta fixa (todo mês)" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("radio", { name: "Conta avulsa (só esta vez)" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: /Confirmar conta/ })).toHaveCount(0);
    await page.getByRole("radio", { name: "Conta avulsa (só esta vez)" }).click();
    await expect(page.getByLabel("Nome da conta avulsa")).toHaveValue("Portões Silva Ltda");
    await expect(page.getByLabel("Conta fixa")).toHaveCount(0);
    // O servidor não confia no navegador: tipo vazio é recusado.
    await page.locator('input[name="bill_kind"]').evaluate((el: HTMLInputElement) => (el.value = ""));
    await page.getByRole("button", { name: "Confirmar conta avulsa" }).click();
    await expect(page.getByText("Escolha o tipo da conta: fixa (todo mês) ou avulsa (só esta vez).")).toBeVisible();
    expect((await admin.from("fin_documents").select("status").eq("id", docId).single()).data).toEqual({ status: "pendente" });
  });

  let oneOffId = "";
  let householdId = "";
  await test.step("confirmar avulsa: volta para Casa > Contas com a avulsa junto das fixas da casa", async () => {
    await page.reload();
    await page.getByRole("radio", { name: "Boleto" }).click();
    await page.getByLabel("Beneficiário").fill("Portões Silva Ltda");
    await page.getByLabel("Valor (R$)").fill("480,00");
    await page.getByLabel("Vencimento").fill("2026-12-15");
    await page.getByLabel("Linha digitável").fill(LINHA);
    await page.getByRole("radio", { name: "Conta avulsa (só esta vez)" }).click();
    await page.getByLabel("Nome da conta avulsa").fill(NOME);
    await page.getByRole("button", { name: "Confirmar conta avulsa" }).click();
    await expect(page).toHaveURL(new RegExp(`/casa/contas\\?mes=${MES}$`));
    const row = page.getByTestId("conta-casa").filter({ hasText: NOME });
    await expect(row).toContainText("Conta avulsa (só esta vez)");
    await expect(row).toContainText("480,00");
    await expect(row.getByRole("link", { name: "boleto (PDF)" })).toHaveAttribute("href", `/financas/documentos/${docId}/arquivo`);
    await expect(page.getByTestId("conta-casa").filter({ hasText: "Condomínio" })).toBeVisible();
    // Total do mês: 450 (fixa) + 480 (avulsa).
    await expect(page.getByText("930,00")).toBeVisible();

    const { data: doc } = await admin.from("fin_documents").select("status, kind, bill_id, bill_month, one_off_bill_id, household_id, barcode").eq("id", docId).single();
    expect(doc).toMatchObject({ status: "confirmado", kind: "boleto", bill_id: null, bill_month: null });
    expect(doc!.barcode).toHaveLength(44);
    oneOffId = doc!.one_off_bill_id;
    householdId = doc!.household_id;
    const { data: oneOff } = await admin.from("fin_one_off_bills").select("name, amount, due_date, is_home, paid_on").eq("id", oneOffId).single();
    expect(oneOff).toEqual({ name: NOME, amount: 480, due_date: "2026-12-15", is_home: true, paid_on: null });
    // Nenhuma conta fixa nova: só o Condomínio.
    const { data: bills } = await admin.from("fin_bills").select("name").eq("household_id", householdId);
    expect(bills).toEqual([{ name: "Condomínio" }]);
  });

  await test.step("Finanças: na seção Contas avulsas do mês, nunca entre as contas fixas; não se repete no mês seguinte", async () => {
    await page.goto(`/financas/contas-fixas?mes=${MES}`);
    const avulsas = page.getByRole("region", { name: "Contas avulsas" });
    const row = avulsas.getByTestId("conta-avulsa").filter({ hasText: NOME });
    await expect(row).toContainText("vence 15/12");
    await expect(row).toContainText("480,00");
    await expect(row.getByRole("link", { name: "boleto (PDF)" })).toBeVisible();
    const fixas = page.getByRole("region", { name: "Contas do mês" });
    await expect(fixas.getByRole("link", { name: "Condomínio", exact: true })).toBeVisible();
    await expect(fixas).not.toContainText(NOME);
    await page.goto("/financas/contas-fixas?mes=2027-01");
    await expect(page.getByRole("region", { name: "Contas avulsas" })).toHaveCount(0);
    await expect(page.getByText(NOME)).toHaveCount(0);
    await page.goto("/casa/contas?mes=2027-01");
    await expect(page.getByTestId("conta-casa").filter({ hasText: NOME })).toHaveCount(0);
  });

  await test.step("marcar paga à mão e desfazer", async () => {
    await page.goto(`/financas/contas-fixas?mes=${MES}`);
    const row = page.getByTestId("conta-avulsa").filter({ hasText: NOME });
    await row.getByRole("link", { name: "Marcar paga" }).click();
    await expect(page).toHaveURL(new RegExp(`/financas/contas-fixas/avulsa/${oneOffId}/pagar$`));
    await page.getByLabel("Pago em").fill("2026-12-14");
    await page.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(page).toHaveURL(new RegExp(`/financas/contas-fixas\\?mes=${MES}$`));
    await expect(row).toContainText("Paga");
    await expect(row).toContainText("paga em 14/12");
    expect((await admin.from("fin_one_off_bills").select("paid_on, transaction_id").eq("id", oneOffId).single()).data).toEqual({ paid_on: "2026-12-14", transaction_id: null });
    await page.goto(`/casa/contas?mes=${MES}`);
    await expect(page.getByTestId("conta-casa").filter({ hasText: NOME }).getByTestId("status")).toHaveText("Paga");

    await page.goto(`/financas/contas-fixas?mes=${MES}`);
    await row.getByRole("button", { name: "desfazer" }).click();
    await expect(row.getByRole("link", { name: "Marcar paga" })).toBeVisible();
    expect((await admin.from("fin_one_off_bills").select("paid_on").eq("id", oneOffId).single()).data).toEqual({ paid_on: null });
  });

  await test.step("lançamento que já pagou a conta fixa não paga a avulsa (nem forçando o formulário)", async () => {
    const { data: acc } = await admin.from("fin_accounts").select("id").eq("household_id", householdId).single();
    const { data: tx } = await admin
      .from("fin_transactions")
      .insert({ household_id: householdId, account_id: acc!.id, date: "2026-12-14", description: "PAG PORTOES", amount: -480, source: "manual" })
      .select("id")
      .single();
    const { data: bill } = await admin.from("fin_bills").select("id").eq("household_id", householdId).single();
    const { error } = await admin
      .from("fin_bill_payments")
      .insert({ household_id: householdId, bill_id: bill!.id, month: MES, transaction_id: tx!.id, paid_on: "2026-12-14", amount: 480 });
    expect(error).toBeNull();
    await page.goto(`/financas/contas-fixas/avulsa/${oneOffId}/pagar`);
    // O lançamento já ligado à fixa nem é oferecido...
    await expect(page.getByText("Nenhum lançamento parecido no extrato.", { exact: false })).toBeVisible();
    await expect(page.getByText("PAG PORTOES")).toHaveCount(0);
    // ...e o servidor recusa se alguém forçar o envio.
    await page.locator('input[name="transaction_id"][value="sem"]').evaluate((el: HTMLInputElement, id: string) => (el.value = id), tx!.id);
    await page.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(page.getByText("Este lançamento já pagou uma conta fixa. Desfaça aquele pagamento antes.")).toBeVisible();
    expect((await admin.from("fin_one_off_bills").select("paid_on, transaction_id").eq("id", oneOffId).single()).data).toEqual({ paid_on: null, transaction_id: null });
  });

  await test.step("comprovante marca a avulsa como paga, ligada ao lançamento criado", async () => {
    const compId = await upload(page, "/financas/lancamentos", "comprovante-avulso");
    await page.getByRole("radio", { name: "Comprovante" }).click();
    await page.getByLabel("Valor pago (R$)").fill("480,00");
    await page.getByLabel("Data do pagamento").fill("2026-12-13");
    await page.getByLabel("Descrição").fill("Conserto portão");
    await page.getByLabel("Marcar como paga a conta").selectOption({ label: `${NOME} (avulsa, vence 15/12/2026)` });
    await expect(page.getByLabel("Mês da conta paga")).toHaveCount(0);
    await page.getByRole("button", { name: "Criar lançamento" }).click();
    await expect(page).toHaveURL(new RegExp(`/financas/lancamentos\\?mes=${MES}$`));
    const { data: comp } = await admin.from("fin_documents").select("status, transaction_id").eq("id", compId).single();
    expect(comp!.status).toBe("confirmado");
    const { data: oneOff } = await admin.from("fin_one_off_bills").select("paid_on, transaction_id, paid_auto").eq("id", oneOffId).single();
    expect(oneOff).toEqual({ paid_on: "2026-12-13", transaction_id: comp!.transaction_id, paid_auto: false });
    // O mesmo lançamento não virou pagamento de conta fixa.
    expect((await admin.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("transaction_id", comp!.transaction_id)).count).toBe(0);
    await page.goto(`/casa/contas?mes=${MES}`);
    await expect(page.getByTestId("conta-casa").filter({ hasText: NOME }).getByTestId("status")).toHaveText("Paga");
  });

  await test.step("resumo da Casa: avulsas da casa do mês atual entram na contagem (em aberto e atrasada)", async () => {
    // O resumo usa o mês corrente (fuso SP); as datas saem do relógio do teste, sem depender do dia.
    const now = new Date(Date.now() - 3 * 3_600_000);
    const ym = now.toISOString().slice(0, 7);
    const day = now.getUTCDate();
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    // Sem conta fixa da casa no mês corrente que atrapalhe: o Condomínio (dia 10) fica pago neste mês.
    const { data: bill } = await admin.from("fin_bills").select("id").eq("household_id", householdId).single();
    await admin.from("fin_bill_payments").insert({ household_id: householdId, bill_id: bill!.id, month: ym, paid_on: `${ym}-01`, amount: 450 });
    await page.goto("/casa");
    await expect(page.getByTestId("resumo-contas")).toContainText("Nenhuma conta em aberto no mês.");
    const rows = [
      { household_id: householdId, name: "Avulsa a vencer", amount: 10, due_date: `${ym}-${String(lastDay).padStart(2, "0")}`, is_home: true },
      { household_id: householdId, name: "Avulsa fora da casa", amount: 10, due_date: `${ym}-${String(lastDay).padStart(2, "0")}`, is_home: false },
    ];
    if (day > 1) rows.push({ household_id: householdId, name: "Avulsa atrasada", amount: 10, due_date: `${ym}-01`, is_home: true });
    expect((await admin.from("fin_one_off_bills").insert(rows)).error).toBeNull();
    await page.goto("/casa");
    // Último dia do mês: a "a vencer" vence hoje e ainda conta como em aberto.
    await expect(page.getByTestId("resumo-contas")).toContainText("1 em aberto");
    if (day > 1) await expect(page.getByTestId("resumo-contas")).toContainText("1 atrasada");
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/i.test(p))).toEqual([]);
});
