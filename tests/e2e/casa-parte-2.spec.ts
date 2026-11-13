import { expect, test, type Page } from "@playwright/test";
import { addDays, longDayLabel, toSpDate } from "../../src/lib/agenda/dates";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

/** Casa parte 2: contas da casa (Finanças), documentos e garantias, cardápio e prestadores. */

async function createFamily(page: Page, tag: string) {
  await signUp(page, uniqueEmail(tag));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

const status = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

function pdf(tag: string) {
  return { name: "garantia.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`) };
}

test("Casa parte 2 sem login: páginas e arquivo bloqueados", async ({ page }) => {
  for (const path of ["/casa/contas", "/casa/documentos", "/casa/cardapio", "/casa/prestadores"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  const res = await page.request.get("/casa/documentos/22222222-2222-4222-8222-222222222222/arquivo", { maxRedirects: 0 });
  expect([307, 401]).toContain(res.status());
});

test("Casa parte 2: contas da casa, documentos, cardápio e prestadores (isolados de outra família)", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const problems = watchConsole(a);
  await createFamily(a, "casa2-a");
  const today = toSpDate(new Date());
  const admin = adminClient();
  const suffix = Math.random().toString(36).slice(2, 7);

  await test.step("menu abre com Resumo selecionado; Despensa não existe mais", async () => {
    await a.goto("/casa");
    const nav = a.getByRole("navigation", { name: "Seções de Casa" });
    await expect(nav.locator('[aria-current="page"]')).toContainText("Resumo");
    await expect(nav.getByText("Despensa")).toHaveCount(0);
    // Página à parte: a página 404 padrão do Next aplica estilo inline (CSP), fora do escopo desta tela.
    const p404 = await ctxA.newPage();
    expect((await p404.goto("/casa/despensa"))?.status()).toBe(404);
    await p404.close();
  });

  await test.step("conta da casa: nova pela Casa, aparece na Casa e fica paga após marcar paga", async () => {
    // Conta fixa comum (sem "Conta da casa") não aparece na Casa.
    await a.goto("/financas/contas-fixas/nova");
    await expect(a.getByLabel("Conta da casa (aparece também em Casa)")).not.toBeChecked();
    await a.getByLabel("Nome").fill("Escola");
    await a.getByLabel("Valor esperado (R$)").fill("900,00");
    await a.getByLabel("Vence todo dia").fill("15");
    await a.getByRole("button", { name: "Criar conta fixa" }).click();
    await expect(a).toHaveURL(/\/financas\/contas-fixas$/);

    await a.goto("/casa/contas");
    await expect(a.getByText("Nenhuma conta da casa neste mês.")).toBeVisible();
    await a.getByRole("link", { name: "Nova conta da casa" }).click();
    await expect(a).toHaveURL(/\/financas\/contas-fixas\/nova\?casa=1$/);
    await expect(a.getByLabel("Conta da casa (aparece também em Casa)")).toBeChecked();
    await a.getByLabel("Nome").fill("Condomínio");
    await a.getByLabel("Valor esperado (R$)").fill("450,00");
    await a.getByLabel("Vence todo dia").fill("28");
    await a.getByRole("button", { name: "Criar conta fixa" }).click();
    await expect(a).toHaveURL(/\/casa\/contas$/);
    const row = a.getByTestId("conta-casa").filter({ hasText: "Condomínio" });
    await expect(row).toContainText("R$ 450,00");
    await expect(row.getByTestId("status")).toHaveText(/Em aberto|Atrasada/);
    await expect(a.getByTestId("conta-casa")).toHaveCount(1);

    await a.goto("/casa");
    await expect(a.getByTestId("resumo-contas")).toContainText(/1 em aberto|1 atrasada/);

    await a.goto("/casa/contas");
    await row.getByRole("link", { name: "Marcar paga" }).click();
    await expect(a).toHaveURL(/\/financas\/contas-fixas\/[0-9a-f-]{36}\/pagar\?mes=/);
    await a.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(a).toHaveURL(/\/financas\/contas-fixas\?mes=/);
    await a.goto("/casa/contas");
    await expect(row.getByTestId("status")).toHaveText("Paga");
    await expect(row.getByRole("link", { name: "Marcar paga" })).toHaveCount(0);
    await a.goto("/casa");
    await expect(a.getByTestId("resumo-contas")).toContainText("Nenhuma conta em aberto no mês.");
  });

  let docId = "";
  let householdA = "";
  await test.step("documento com anexo: garantia vencendo em destaque, filtro por tipo e arquivo autenticado", async () => {
    await a.goto("/casa/documentos");
    await expect(a.getByText("Nenhum documento ainda.")).toBeVisible();
    await a.getByRole("button", { name: "Novo documento" }).click();
    let d = a.getByRole("dialog", { name: "Novo documento" });
    await d.getByLabel("Título").fill("Garantia da geladeira");
    await d.getByLabel("Garantia até").fill(addDays(today, 10));
    // Arquivo que não é PDF/JPG (pelos bytes) é recusado no servidor.
    await d.getByRole("group", { name: /Arquivo opcional/ }).getByLabel("PDF", { exact: true }).setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>oi</html>") });
    await d.getByRole("button", { name: "Salvar documento" }).click();
    await expect(d.getByText("Envie um arquivo PDF ou JPG.")).toBeVisible();
    await d.getByRole("group", { name: /Arquivo opcional/ }).getByLabel("PDF", { exact: true }).setInputFiles(pdf("casa"));
    await d.getByRole("button", { name: "Salvar documento" }).click();
    await expect(status(a, "Documento salvo.")).toBeVisible();

    const card = a.getByTestId("documento").filter({ hasText: "Garantia da geladeira" });
    await expect(card).toContainText("Garantia vencendo");
    await expect(a.getByRole("region", { name: "Garantias em destaque" })).toContainText("Garantia da geladeira");
    const href = await card.getByRole("link", { name: "Abrir PDF" }).getAttribute("href");
    docId = href!.match(/\/casa\/documentos\/([0-9a-f-]{36})\/arquivo$/)![1];
    const res = await a.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["content-disposition"]).toContain("inline");

    await a.getByRole("button", { name: "Manual", exact: true }).click();
    await expect(a.getByText("Nenhum documento deste tipo.")).toBeVisible();
    await a.getByRole("button", { name: "Garantia", exact: true }).click();
    await expect(card).toBeVisible();
    await a.getByRole("button", { name: "Todos", exact: true }).click();

    await a.goto("/casa");
    await expect(a.getByTestId("resumo-documentos")).toContainText("1 garantia vencendo");

    const { data } = await admin.from("casa_documents").select("household_id, file_path").eq("id", docId).single();
    householdA = data!.household_id as string;
    expect(data!.file_path).toMatch(new RegExp(`^${householdA}/docs/[0-9a-f-]{36}\\.pdf$`));

    // Editar: remover o arquivo apaga também do bucket.
    await a.goto("/casa/documentos");
    await card.getByRole("button", { name: "Editar" }).click();
    d = a.getByRole("dialog", { name: "Editar documento" });
    await d.getByLabel("Remover o arquivo atual").check();
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(status(a, "Documento atualizado.")).toBeVisible();
    await expect(card.getByRole("link", { name: "Abrir PDF" })).toHaveCount(0);
    expect((await a.request.get(href!)).status()).toBe(404);
    const { data: objs } = await admin.storage.from("casa").list(`${householdA}/docs`);
    expect((objs ?? []).filter((o) => data!.file_path.endsWith(o.name))).toHaveLength(0);

    // Anexa de novo para o teste da outra família.
    await card.getByRole("button", { name: "Editar" }).click();
    d = a.getByRole("dialog", { name: "Editar documento" });
    await d.getByRole("group", { name: /Arquivo opcional/ }).getByLabel("PDF", { exact: true }).setInputFiles(pdf("casa-2"));
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(d).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Abrir PDF" })).toBeVisible();
    expect((await a.request.get(href!)).status()).toBe(200);
  });

  await test.step("cardápio: editar refeição, mandar ingredientes para a lista sem duplicar e copiar a semana", async () => {
    await a.goto("/casa/compras");
    const add = a.getByRole("form", { name: "Adicionar à lista" });
    await add.getByLabel("Item", { exact: true }).fill("feijao");
    await add.getByRole("button", { name: "Adicionar" }).click();
    await expect(status(a, "feijao adicionado à lista.")).toBeVisible();

    await a.goto("/casa/cardapio");
    const slot = a.getByRole("listitem", { name: `Almoço de ${longDayLabel(today)}` });
    await slot.getByRole("button", { name: "Planejar" }).click();
    const d = a.getByRole("dialog", { name: `Almoço · ${longDayLabel(today)}` });
    await d.getByLabel("Prato").fill("Feijoada");
    await d.getByLabel("Ingredientes (um por linha)").fill("Arroz\nFeijão\nCebola\ncebola");
    await d.getByRole("button", { name: "Salvar refeição" }).click();
    await expect(status(a, "Refeição salva.")).toBeVisible();
    await expect(slot).toContainText("Feijoada");
    await expect(slot).toContainText("Arroz, Feijão, Cebola");

    await slot.getByRole("button", { name: "Mandar para a lista" }).click();
    await expect(status(a, "2 itens adicionados à lista de compras; 1 já estava na lista.")).toBeVisible();
    await a.getByRole("button", { name: "Mandar ingredientes da semana para a lista de compras" }).click();
    await expect(status(a, "Nenhum item novo na lista de compras; 3 já estavam na lista.")).toBeVisible();

    await a.goto("/casa/compras");
    await expect(a.getByRole("checkbox", { name: "Arroz" })).toHaveCount(1);
    await expect(a.getByRole("checkbox", { name: "Cebola" })).toHaveCount(1);
    await expect(a.getByRole("checkbox", { name: "feijao" })).toHaveCount(1);
    await expect(a.getByRole("checkbox", { name: "Feijão" })).toHaveCount(0);

    // Dois aparelhos salvam a mesma refeição ao mesmo tempo: upsert, sem erro e sem duplicar.
    const next = addDays(today, 7);
    await a.goto("/casa/cardapio");
    await a.getByRole("link", { name: "Próxima semana" }).click();
    await expect(a).toHaveURL(/semana=/);
    await a.getByRole("button", { name: "Copiar a semana anterior" }).click();
    await expect(status(a, "1 refeição copiada da semana anterior.")).toBeVisible();
    const copied = a.getByRole("listitem", { name: `Almoço de ${longDayLabel(next)}` });
    await expect(copied).toContainText("Feijoada");
    await a.getByRole("button", { name: "Copiar a semana anterior" }).click();
    await expect(status(a, "Nada para copiar: esta semana já tem essas refeições.")).toBeVisible();

    const a2 = await ctxA.newPage();
    const url = a.url();
    await a2.goto(url);
    const open = async (p: Page, title: string) => {
      await p.getByRole("listitem", { name: `Jantar de ${longDayLabel(next)}` }).getByRole("button", { name: "Planejar" }).click();
      const dlg = p.getByRole("dialog", { name: `Jantar · ${longDayLabel(next)}` });
      await dlg.getByLabel("Prato").fill(title);
      return dlg;
    };
    const [d1, d2] = [await open(a, "Sopa"), await open(a2, "Omelete")];
    await Promise.all([d1.getByRole("button", { name: "Salvar refeição" }).click(), d2.getByRole("button", { name: "Salvar refeição" }).click()]);
    await expect(status(a, "Refeição salva.")).toBeVisible();
    await expect(status(a2, "Refeição salva.")).toBeVisible();
    await a2.close();
    const { count } = await admin.from("casa_meal_plan").select("id", { count: "exact", head: true }).eq("household_id", householdA).eq("day", next).eq("meal", "jantar");
    expect(count).toBe(1);

    await a.goto("/casa");
    await expect(a.getByTestId("resumo-cardapio")).toContainText("Almoço: Feijoada");
  });

  let providerA = "";
  await test.step("prestador: ligar e WhatsApp só com dígitos; ligado a uma manutenção", async () => {
    await a.goto("/casa/prestadores");
    await a.getByRole("button", { name: "Novo prestador" }).click();
    const d = a.getByRole("dialog", { name: "Novo prestador" });
    await d.getByLabel("Nome").fill(`João Refrigeração ${suffix}`);
    await d.getByLabel("Serviço").fill("Ar-condicionado");
    await d.getByLabel("Telefone").fill("11 9876 abc");
    await d.getByRole("button", { name: "Salvar prestador" }).click();
    await expect(d.getByText("Telefone só com números, espaços, +, - e parênteses.")).toBeVisible();
    await d.getByLabel("Telefone").fill("(11) 98765-4321");
    await d.getByRole("button", { name: "Salvar prestador" }).click();
    await expect(status(a, "Prestador salvo.")).toBeVisible();
    const card = a.getByRole("region", { name: "Ar-condicionado" }).getByTestId("prestador");
    await expect(card.getByRole("link", { name: /^Ligar para/ })).toHaveAttribute("href", "tel:11987654321");
    await expect(card.getByRole("link", { name: /^WhatsApp de/ })).toHaveAttribute("href", "https://wa.me/5511987654321");

    await a.goto("/casa/manutencao");
    await a.getByRole("button", { name: "Nova manutenção" }).click();
    const m = a.getByRole("dialog", { name: "Nova manutenção" });
    await m.getByLabel("Manutenção", { exact: true }).fill("Limpar o ar-condicionado");
    await m.getByLabel("A cada").fill("6");
    await m.getByLabel("Prestador cadastrado").selectOption({ label: `João Refrigeração ${suffix} (Ar-condicionado)` });
    await m.getByRole("button", { name: "Salvar manutenção" }).click();
    await expect(status(a, "Manutenção salva.")).toBeVisible();
    const contact = a.getByTestId("manutencao").filter({ hasText: "Limpar o ar-condicionado" }).getByTestId("contato-prestador");
    await expect(contact).toContainText(`João Refrigeração ${suffix} · (11) 98765-4321`);
    await expect(contact.getByRole("link", { name: /^WhatsApp de/ })).toHaveAttribute("href", "https://wa.me/5511987654321");

    const { data } = await admin.from("casa_providers").select("id").eq("household_id", householdA).single();
    providerA = data!.id as string;
  });

  await test.step("outra família: 404 no arquivo, nada visível e prestador alheio barrado", async () => {
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await createFamily(b, "casa2-b");
    expect((await b.request.get(`/casa/documentos/${docId}/arquivo`)).status()).toBe(404);
    expect((await b.request.get("/casa/documentos/nao-e-uuid/arquivo")).status()).toBe(404);
    await b.goto("/casa/contas");
    await expect(b.getByText("Nenhuma conta da casa neste mês.")).toBeVisible();
    await b.goto("/casa/documentos");
    await expect(b.getByText("Nenhum documento ainda.")).toBeVisible();
    await b.goto("/casa/cardapio");
    await expect(b.getByText("Feijoada")).toHaveCount(0);

    await b.goto("/casa/prestadores");
    await expect(b.getByText("Nenhum prestador ainda.")).toBeVisible();
    await b.getByRole("button", { name: "Novo prestador" }).click();
    const d = b.getByRole("dialog", { name: "Novo prestador" });
    await d.getByLabel("Nome").fill("Prestador B");
    await d.getByRole("button", { name: "Salvar prestador" }).click();
    await expect(status(b, "Prestador salvo.")).toBeVisible();

    // Formulário adulterado com o id do prestador da família A: o servidor recusa.
    await b.goto("/casa/manutencao");
    await b.getByRole("button", { name: "Nova manutenção" }).click();
    const m = b.getByRole("dialog", { name: "Nova manutenção" });
    await m.getByLabel("Manutenção", { exact: true }).fill("Teste");
    await m.getByLabel("Prestador cadastrado").evaluate((el, id) => {
      const s = el as HTMLSelectElement;
      s.options[1].value = id;
      s.value = id;
    }, providerA);
    await m.getByRole("button", { name: "Salvar manutenção" }).click();
    await expect(m.getByText("Escolha um prestador da família", { exact: false })).toBeVisible();
    await ctxB.close();
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/.test(p))).toEqual([]);
  await ctxA.close();
});
