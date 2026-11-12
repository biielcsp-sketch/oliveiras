import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./admin";
import { PASSWORD, signUp, uniqueEmail, watchConsole } from "./helpers";
import { mod11Bancario, toLinhaDigitavel } from "../../src/lib/financas/documentos/boleto";

/**
 * Contas fixas (ex-"Contas a pagar"): rota antiga redireciona, editar/apagar documentos e baixa
 * automática pelo extrato (OFX gerado no teste). Família comum (sem leitura por IA): os documentos
 * são preenchidos à mão na conferência.
 */

const DOC_URL = /\/financas\/documentos\/([0-9a-f-]{36})$/;

function pdf(tag: string) {
  return { name: "documento.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`) };
}

/** Boleto bancário sintético com DV correto (vencimento 10/12/2026). */
function syntheticBoleto(cents: string, livre: string) {
  const factor = 1000 + Math.round((Date.UTC(2026, 11, 10) - Date.UTC(2025, 1, 22)) / 86_400_000);
  const head = "3419";
  const rest = `${factor}${cents.padStart(10, "0")}${livre}`;
  return toLinhaDigitavel(head + mod11Bancario(head + rest) + rest)!;
}
const BOLETO = syntheticBoleto("18790", "1091234567812345678955555");

function ofx(rows: { id: string; date: string; amount: string; memo: string }[]) {
  const body = rows
    .map((r) => `<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>${r.date.replace(/-/g, "")}\n<TRNAMT>${r.amount}\n<FITID>${r.id}\n<MEMO>${r.memo}\n</STMTTRN>`)
    .join("\n");
  const text = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nCHARSET:1252\n\n<OFX>\n<BANKMSGSRSV1><STMTTRNRS><STMTRS>\n<BANKTRANLIST>\n${body}\n</BANKTRANLIST>\n</STMTRS></STMTTRNRS></BANKMSGSRSV1>\n</OFX>\n`;
  return { name: "extrato-dez.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(text) };
}

async function upload(page: Page, tag: string) {
  await page.goto("/financas/documentos");
  const box = page.getByRole("region", { name: "Ler PDF ou foto" });
  await box.getByLabel("Arquivo (PDF ou JPG, até 5 MB)").setInputFiles(pdf(tag));
  await box.getByRole("button", { name: "Ler documento" }).click();
  await expect(page).toHaveURL(DOC_URL, { timeout: 45_000 });
  return page.url().match(DOC_URL)![1];
}

async function comprovante(page: Page, tag: string, opts: { payee: string; amount: string; date: string; description: string; payBill?: string }) {
  const id = await upload(page, tag);
  await page.getByRole("radio", { name: "Comprovante" }).click();
  await page.getByLabel("Favorecido").fill(opts.payee);
  await page.getByLabel("Valor pago (R$)").fill(opts.amount);
  await page.getByLabel("Data do pagamento").fill(opts.date);
  await page.getByLabel("Descrição").fill(opts.description);
  if (opts.payBill) {
    await page.getByLabel("Marcar como paga a conta").selectOption({ label: opts.payBill });
    await page.getByLabel("Mês da conta paga").fill(opts.date.slice(0, 7));
  }
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page).toHaveURL(/\/financas\/lancamentos\?mes=/);
  return id;
}

test("Contas fixas: rota antiga, editar/apagar documentos e baixa automática pelo extrato", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  const admin = adminClient();
  let householdId = "";
  const email = uniqueEmail("fixas");

  await test.step("família, conta bancária e contas fixas Luz (R$ 100, dia 10) e Água (R$ 80, dia 15)", async () => {
    await signUp(page, email);
    await page.getByLabel("Seu nome").fill("Gabriel");
    await page.locator("form").getByRole("button", { name: "Criar família" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await page.goto("/financas/contas/nova");
    await page.getByLabel("Nome", { exact: true }).fill("Conta Teste");
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/financas\/contas$/);
    for (const [name, amount, day] of [["Luz", "100,00", "10"], ["Água", "80,00", "15"]]) {
      await page.goto("/financas/contas-fixas/nova");
      await expect(page.getByRole("heading", { name: "Nova conta fixa" })).toBeVisible();
      await page.getByLabel("Nome").fill(name);
      await page.getByLabel("Valor esperado (R$)").fill(amount);
      await page.getByLabel("Vence todo dia").fill(day);
      await page.getByRole("button", { name: "Criar conta fixa" }).click();
      await expect(page).toHaveURL(/\/financas\/contas-fixas$/);
    }
    const { data } = await admin.from("fin_bills").select("household_id").eq("name", "Água").order("created_at", { ascending: false }).limit(1).single();
    householdId = data!.household_id;
  });

  await test.step("rota antiga redireciona (308) para Contas fixas, com subpáginas e mês", async () => {
    const res = await page.request.get("/financas/contas-a-pagar/nova?x=1", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toBe("/financas/contas-fixas/nova?x=1");
    await page.goto("/financas/contas-a-pagar?mes=2026-12");
    await expect(page).toHaveURL(/\/financas\/contas-fixas\?mes=2026-12$/);
    await expect(page.getByRole("link", { name: "Luz", exact: true })).toBeVisible();
    await expect(page).toHaveTitle(/^Contas fixas · /);
  });

  let boletoId = "";
  await test.step("boleto conferido à mão e editado (valor e vencimento)", async () => {
    boletoId = await upload(page, "boleto");
    await page.getByRole("radio", { name: "Boleto" }).click();
    await page.getByRole("radio", { name: "Conta fixa (todo mês)" }).click();
    await page.getByLabel("Beneficiário").fill("ENEL Distribuição");
    await page.getByLabel("Valor (R$)").fill("187,90");
    await page.getByLabel("Vencimento").fill("2026-12-10");
    await page.getByLabel("Linha digitável").fill(BOLETO);
    await page.getByLabel("Conta fixa").selectOption({ label: "Luz" });
    await page.getByLabel("Mês da conta").fill("2026-12");
    await page.getByRole("button", { name: "Confirmar conta fixa" }).click();
    await expect(page).toHaveURL(/\/financas\/contas-fixas\?mes=2026-12$/);

    await page.goto("/financas/documentos");
    await page.getByRole("link", { name: "Editar ENEL Distribuição" }).click();
    await expect(page).toHaveURL(new RegExp(`/financas/documentos/${boletoId}/editar$`));
    await expect(page.getByLabel("Valor (R$)")).toHaveValue("187,90");
    await expect(page.getByLabel("Conta fixa").locator("option:checked")).toHaveText("Luz");
    await page.getByLabel("Valor (R$)").fill("190,00");
    await page.getByLabel("Vencimento").fill("2026-12-11");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page).toHaveURL(new RegExp(`/financas/documentos/${boletoId}$`));
    await expect(page.getByText("R$ 190,00")).toBeVisible();
    const { data } = await admin.from("fin_documents").select("amount, due_date, bill_month, status").eq("id", boletoId).single();
    expect(data).toEqual({ amount: 190, due_date: "2026-12-11", bill_month: "2026-12", status: "confirmado" });
  });

  await test.step("importar OFX: saída igual ao boleto dá baixa automática; Água ambígua vira sugestão", async () => {
    await page.goto("/financas/importar");
    await page.locator('select[name="account_id"]').selectOption({ label: "Conta Teste" });
    await page.getByLabel("Arquivo OFX ou CSV do banco").setInputFiles(
      ofx([
        { id: "D1", date: "2026-12-09", amount: "-190.00", memo: "PAG BOLETO ENEL DISTRIB" },
        { id: "D2", date: "2026-12-14", amount: "-80.00", memo: "SABESP AGUA" },
        { id: "D3", date: "2026-12-16", amount: "-80.00", memo: "AGUA SABESP" },
      ]),
    );
    await page.getByRole("button", { name: "Pré-visualizar" }).click();
    await page.getByRole("button", { name: "Importar 3 lançamentos" }).click();
    await expect(page.getByRole("status")).toContainText("3 lançamentos importados");
    await expect(page.getByTestId("baixas-automaticas")).toHaveText("Baixa automática em Contas fixas: Luz (12/2026).");

    await page.goto("/financas/contas-fixas?mes=2026-12");
    const luz = page.locator("li").filter({ has: page.getByRole("link", { name: "Luz", exact: true }) });
    await expect(luz).toContainText("Paga");
    await expect(luz).toContainText("paga em 09/12");
    const { data: tx } = await admin.from("fin_transactions").select("id").eq("household_id", householdId).eq("external_id", "ofx:D1").single();
    await expect(luz.getByRole("link", { name: "Baixa automática" })).toHaveAttribute("href", `/financas/lancamentos/${tx!.id}`);
    const agua = page.locator("li").filter({ has: page.getByRole("link", { name: "Água", exact: true }) });
    await expect(agua.getByRole("group", { name: "Sugestão de pagamento de Água" })).toHaveCount(2);
    await expect(agua).toContainText("Marcar paga");
    const { count } = await admin.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("household_id", householdId);
    expect(count).toBe(1);
  });

  await test.step("'Não é' tira a sugestão; 'Procurar pagamentos no extrato' baixa a que sobrou; rodar de novo não duplica", async () => {
    const agua = () => page.locator("li").filter({ has: page.getByRole("link", { name: "Água", exact: true }) });
    await agua().getByRole("group").filter({ hasText: "AGUA SABESP" }).getByRole("button", { name: "Não é" }).click();
    await expect(agua().getByRole("group", { name: "Sugestão de pagamento de Água" })).toHaveCount(1);
    const { data: d3 } = await admin.from("fin_transactions").select("id").eq("household_id", householdId).eq("external_id", "ofx:D3").single();
    const { data: nao } = await admin.from("fin_baixa_dismissals").select("reason").eq("household_id", householdId).eq("transaction_id", d3!.id).single();
    expect(nao).toEqual({ reason: "nao_e" });
    await page.getByRole("button", { name: "Procurar pagamentos no extrato" }).click();
    await expect(page.getByRole("status")).toHaveText("1 conta paga pelo extrato.");
    await expect(agua().getByRole("link", { name: "Baixa automática" })).toBeVisible();
    await expect(agua()).toContainText("paga em 14/12");
    await page.getByRole("button", { name: "Procurar pagamentos no extrato" }).click();
    await expect(page.getByRole("status")).toHaveText("Nenhum pagamento novo encontrado com certeza.");
    const { data: pays } = await admin.from("fin_bill_payments").select("auto").eq("household_id", householdId);
    expect(pays).toEqual([{ auto: true }, { auto: true }]);
  });

  await test.step("desfazer a baixa automática num aparelho: outro aparelho rodando o cruzamento não refaz", async () => {
    const luz = (p: Page) => p.locator("li").filter({ has: p.getByRole("link", { name: "Luz", exact: true }) });
    await luz(page).getByRole("button", { name: "desfazer" }).click();
    await expect(luz(page).getByRole("link", { name: "Marcar paga" })).toBeVisible();
    await expect(luz(page).getByRole("group")).toHaveCount(0);
    const { data: d1 } = await admin.from("fin_transactions").select("id").eq("household_id", householdId).eq("external_id", "ofx:D1").single();
    const { data: desfeita } = await admin.from("fin_baixa_dismissals").select("reason").eq("household_id", householdId).eq("transaction_id", d1!.id).single();
    expect(desfeita).toEqual({ reason: "desfeita" });

    // "Outro aparelho": sessão nova (sem nada do navegador anterior), mesmo login.
    const ctx2 = await browser.newContext();
    const other = await ctx2.newPage();
    await other.goto("/login");
    await other.getByLabel("E-mail").fill(email);
    await other.getByLabel("Senha").fill(PASSWORD);
    await other.locator("form").getByRole("button", { name: "Entrar" }).click();
    await expect(other).toHaveURL(/\/inicio$/);
    await other.goto("/financas/contas-fixas?mes=2026-12");
    await expect(luz(other).getByRole("group")).toHaveCount(0);
    await other.getByRole("button", { name: "Procurar pagamentos no extrato" }).click();
    await expect(other.getByRole("status")).toHaveText("Nenhum pagamento novo encontrado com certeza.");
    await expect(luz(other).getByRole("link", { name: "Marcar paga" })).toBeVisible();
    await ctx2.close();
    const { count } = await admin.from("fin_bill_payments").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("transaction_id", d1!.id);
    expect(count).toBe(0);
  });

  await test.step("apagar documento sem lançamento: confirmação, some a linha e o arquivo", async () => {
    const { data: before } = await admin.from("fin_documents").select("file_path").eq("id", boletoId).single();
    await page.goto(`/financas/documentos/${boletoId}`);
    await page.getByRole("link", { name: "Apagar documento" }).click();
    await expect(page.getByRole("heading", { name: "Apagar documento?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apagar só o documento" })).toHaveCount(0);
    await page.getByRole("button", { name: "Apagar documento" }).click();
    await expect(page).toHaveURL(/\/financas\/documentos$/);
    const { data: gone } = await admin.from("fin_documents").select("id").eq("id", boletoId).maybeSingle();
    expect(gone).toBeNull();
    const { data: files } = await admin.storage.from("financas").list(before!.file_path.split("/").slice(0, 2).join("/"));
    expect((files ?? []).map((f) => f.name)).not.toContain(before!.file_path.split("/").pop());
    // Lançamentos do extrato continuam.
    const { count } = await admin.from("fin_transactions").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("source", "ofx");
    expect(count).toBe(3);
  });

  await test.step("comprovante: 'Apagar só o documento' mantém o lançamento", async () => {
    const id = await comprovante(page, "comp-a", { payee: "Padaria", amount: "12,00", date: "2026-12-05", description: "Pão de sábado" });
    const { data: doc } = await admin.from("fin_documents").select("transaction_id").eq("id", id).single();
    await page.goto("/financas/documentos");
    await page.getByRole("link", { name: "Apagar Padaria" }).click();
    await expect(page.getByRole("button", { name: "Apagar documento e o lançamento/baixa criados por ele" })).toBeVisible();
    await page.getByRole("button", { name: "Apagar só o documento" }).click();
    await expect(page).toHaveURL(/\/financas\/documentos$/);
    expect((await admin.from("fin_documents").select("id").eq("id", id).maybeSingle()).data).toBeNull();
    expect((await admin.from("fin_transactions").select("source").eq("id", doc!.transaction_id).single()).data).toEqual({ source: "documento" });
  });

  await test.step("comprovante que pagou Luz: apagar com lançamento e baixa; extrato intacto", async () => {
    const id = await comprovante(page, "comp-b", { payee: "ENEL", amount: "190,00", date: "2026-12-10", description: "Luz dezembro", payBill: "Luz" });
    const { data: doc } = await admin.from("fin_documents").select("transaction_id").eq("id", id).single();
    // Pagamento marcado à mão (comprovante): auto=false, sem a marca de baixa automática.
    expect((await admin.from("fin_bill_payments").select("month, auto").eq("transaction_id", doc!.transaction_id).single()).data).toEqual({ month: "2026-12", auto: false });
    await page.goto("/financas/contas-fixas?mes=2026-12");
    const luzPaga = page.locator("li").filter({ has: page.getByRole("link", { name: "Luz", exact: true }) });
    await expect(luzPaga).toContainText("Paga");
    await expect(luzPaga.getByRole("link", { name: "Baixa automática" })).toHaveCount(0);
    await page.goto(`/financas/documentos/${id}`);
    await expect(page.getByRole("link", { name: "Editar documento" })).toBeVisible();
    await page.getByRole("link", { name: "Apagar documento" }).click();
    await expect(page.getByText("marcou uma conta fixa como paga")).toBeVisible();
    await page.getByRole("button", { name: "Apagar documento e o lançamento/baixa criados por ele" }).click();
    await expect(page).toHaveURL(/\/financas\/documentos$/);
    expect((await admin.from("fin_transactions").select("id").eq("id", doc!.transaction_id).maybeSingle()).data).toBeNull();
    expect((await admin.from("fin_bill_payments").select("id").eq("transaction_id", doc!.transaction_id).maybeSingle()).data).toBeNull();
    const { count } = await admin.from("fin_transactions").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("source", "ofx");
    expect(count).toBe(3);
    await page.goto("/financas/contas-fixas?mes=2026-12");
    await expect(page.locator("li").filter({ has: page.getByRole("link", { name: "Luz", exact: true }) }).getByRole("link", { name: "Marcar paga" })).toBeVisible();
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/i.test(p))).toEqual([]);
});
