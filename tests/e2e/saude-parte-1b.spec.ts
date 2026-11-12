import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF"), Buffer.alloc(32), Buffer.from([0xff, 0xd9])]);
const pdf = { name: "laudo.pdf", mimeType: "application/pdf", buffer: PDF };
const jpg = { name: "comprovante.jpg", mimeType: "image/jpeg", buffer: JPG };

async function createFamily(page: Page, tag: string) {
  await signUp(page, uniqueEmail(tag));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/familia");
  await page.getByPlaceholder("Nome do dependente").fill("Filho Teste");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("Filho Teste")).toBeVisible();
}

const cachedPaths = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });

test("Saúde 1b: procedimentos, medicamentos e vacinas (arquivos privados, família compartilhada)", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const problems = watchConsole(a);
  await createFamily(a, "saude1b-a");

  let procPath = "";
  let vacPath = "";
  let procId = "";

  await test.step("sub-navegação ganha as 3 abas", async () => {
    await a.goto("/saude/procedimentos");
    const nav = a.getByRole("navigation", { name: "Seções de Saúde" });
    for (const t of ["Procedimentos", "Medicamentos", "Vacinas"]) await expect(nav.getByRole("link", { name: t })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Procedimentos" })).toHaveAttribute("aria-current", "page");
  });

  await test.step("procedimento: recusa arquivo falso e grande; aceita PDF; texto como texto", async () => {
    await expect(a.getByText("Nenhum procedimento ainda.")).toBeVisible();
    await a.getByRole("button", { name: "Novo procedimento" }).click();
    const d = a.getByRole("dialog", { name: "Novo procedimento" });
    await d.getByLabel("Pessoa").selectOption({ label: "Filho Teste" });
    await d.getByLabel("Procedimento", { exact: true }).fill("Cirurgia <b>amígdalas</b>");
    await d.getByLabel("Data de realização").fill("2026-03-10");
    await d.getByLabel("Local").fill("Hospital Central");
    await d.getByRole("group", { name: "Arquivo opcional" }).getByLabel("PDF", { exact: true }).setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await d.getByRole("button", { name: "Salvar procedimento" }).click();
    await expect(d.getByText("Envie um arquivo PDF ou JPG.")).toBeVisible();
    await d.getByRole("group", { name: "Arquivo opcional" }).getByLabel("PDF", { exact: true }).setInputFiles({ name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) });
    await d.getByRole("button", { name: "Salvar procedimento" }).click();
    await expect(d.getByText("O arquivo passa de 5 MB.")).toBeVisible();
    await d.getByRole("group", { name: "Arquivo opcional" }).getByLabel("PDF", { exact: true }).setInputFiles(pdf);
    await d.getByRole("button", { name: "Salvar procedimento" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Procedimento salvo." })).toBeVisible();
    const item = a.getByTestId("procedimento");
    await expect(item).toContainText("Cirurgia <b>amígdalas</b>");
    await expect(item).toContainText("Filho Teste · 10/03/2026");
    procPath = (await item.getByRole("link", { name: "Abrir PDF" }).getAttribute("href"))!;
    expect(procPath).toMatch(/^\/saude\/arquivo\/procedimentos\/[0-9a-f-]{36}$/);
    procId = procPath.split("/").pop()!;
  });

  await test.step("procedimento: arquivo só pela rota autenticada, com cabeçalhos seguros", async () => {
    const res = await a.request.get(procPath);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["cache-control"]).toBe("private, no-store");
    expect(res.headers()["content-disposition"]).toBe('inline; filename="arquivo.pdf"');
    const { data } = await adminClient().from("health_procedures").select("file_path, file_mime, file_size").eq("id", procId).single();
    expect(data).toMatchObject({ file_mime: "application/pdf", file_size: PDF.length });
    expect(data!.file_path).toMatch(/^[0-9a-f-]{36}\/procedures\/[0-9a-f-]{36}\.pdf$/);
    const pub = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/saude/${data!.file_path}`);
    expect(pub.status).toBeGreaterThanOrEqual(400);
  });

  await test.step("procedimento: trocar por JPG apaga o PDF antigo; editar sem arquivo mantém", async () => {
    const { data: before } = await adminClient().from("health_procedures").select("household_id, file_path").eq("id", procId).single();
    await a.getByTestId("procedimento").getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar procedimento" });
    await d.getByLabel("Médico").fill("Dr. Paulo");
    await d.getByRole("group", { name: "Trocar arquivo" }).getByLabel("Imagem", { exact: true }).setInputFiles(jpg);
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Procedimento atualizado." })).toBeVisible();
    await expect(a.getByTestId("procedimento")).toContainText("Dr. Paulo");
    expect((await a.request.get(procPath)).headers()["content-type"]).toBe("image/jpeg");
    const { data: files } = await adminClient().storage.from("saude").list(`${before!.household_id}/procedures`);
    expect(files!.map((f) => `${before!.household_id}/procedures/${f.name}`)).not.toContain(before!.file_path);
    expect(files).toHaveLength(1);
  });

  await test.step("medicamento: em uso, encerrar, reativar, término antes do início recusado, apagar", async () => {
    await a.goto("/saude/medicamentos");
    await a.getByRole("button", { name: "Novo medicamento" }).click();
    const d = a.getByRole("dialog", { name: "Novo medicamento" });
    await d.getByLabel("Pessoa").selectOption({ label: "Filho Teste" });
    await d.getByLabel("Medicamento", { exact: true }).fill("Amoxicilina");
    await d.getByLabel("Dose", { exact: true }).fill("250 mg");
    await d.getByLabel("Frequência").fill("a cada 8 horas");
    await d.getByLabel("Início do uso").fill("2026-01-10");
    await d.getByLabel(/Fim do uso/).fill("2026-01-05");
    await d.getByRole("button", { name: "Salvar medicamento" }).click();
    await expect(d.getByText("O término não pode ser antes do início.")).toBeVisible();
    await d.getByLabel(/Fim do uso/).fill("");
    await d.getByRole("button", { name: "Salvar medicamento" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Medicamento salvo." })).toBeVisible();

    const using = a.getByRole("region", { name: "Medicamentos em uso" });
    await expect(using.getByTestId("medicamento")).toContainText("Amoxicilina — 250 mg");
    await using.getByRole("button", { name: "Encerrar" }).click();
    const ended = a.getByRole("region", { name: "Medicamentos encerrados" });
    await expect(ended.getByTestId("medicamento")).toContainText("Amoxicilina");
    await expect(ended.getByTestId("medicamento")).toContainText("Desde 10/01/2026");
    await expect(ended.getByTestId("medicamento")).toContainText("Até ");
    const { data: row } = await adminClient().from("health_medications").select("active, ended_on, started_on").eq("name", "Amoxicilina").single();
    expect(row!.active).toBe(false);
    expect(row!.ended_on! >= row!.started_on!).toBe(true);

    await ended.getByRole("button", { name: "Reativar" }).click();
    await expect(a.getByRole("region", { name: "Medicamentos em uso" }).getByTestId("medicamento")).toContainText("Amoxicilina");
    const { data: row2 } = await adminClient().from("health_medications").select("active, ended_on").eq("name", "Amoxicilina").single();
    expect(row2).toEqual({ active: true, ended_on: null });

    await a.getByTestId("medicamento").getByRole("button", { name: "Apagar" }).click();
    await a.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(a.getByText("Nenhum medicamento ainda.")).toBeVisible();
  });

  await test.step("vacina: abre no filho, próxima dose na lista, comprovante JPG, filtro por pessoa", async () => {
    await a.goto("/saude/vacinas");
    const filter = a.getByRole("group", { name: "Filtrar por pessoa" });
    await expect(filter.getByRole("button", { name: "Filho Teste" })).toHaveAttribute("aria-pressed", "true");
    await expect(a.getByText("Nenhuma vacina de Filho Teste ainda.")).toBeVisible();
    await a.getByRole("button", { name: "Nova vacina" }).click();
    const d = a.getByRole("dialog", { name: "Nova vacina" });
    await expect(d.getByLabel("Pessoa").locator("option:checked")).toHaveText("Filho Teste");
    await d.getByLabel("Vacina", { exact: true }).fill("Hepatite B");
    await d.getByLabel("Dose", { exact: true }).fill("2ª dose");
    await d.getByLabel("Data de aplicação").fill("2026-05-01");
    await d.getByLabel("Próxima dose").fill("2099-11-01");
    await d.getByLabel("Lote").fill("L123");
    await d.getByRole("group", { name: "Comprovante opcional" }).getByLabel("Imagem", { exact: true }).setInputFiles(jpg);
    await d.getByRole("button", { name: "Salvar vacina" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Vacina salva." })).toBeVisible();
    const item = a.getByTestId("vacina");
    await expect(item).toContainText("Hepatite B — 2ª dose");
    await expect(item).toContainText("Próxima dose: 01/11/2099");
    await expect(item).toContainText("Lote L123");
    vacPath = (await item.getByRole("link", { name: "Abrir foto" }).getAttribute("href"))!;
    expect(vacPath).toMatch(/^\/saude\/arquivo\/vacinas\/[0-9a-f-]{36}$/);
    const res = await a.request.get(vacPath);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");

    await filter.getByRole("button", { name: "Gabriel" }).click();
    await expect(a.getByTestId("vacina")).toHaveCount(0);
    await filter.getByRole("button", { name: "Todos" }).click();
    await expect(a.getByTestId("vacina")).toHaveCount(1);
  });

  await test.step("procedimentos, medicamentos e vacinas nunca vão para o cache offline", async () => {
    await a.goto("/saude/vacinas");
    await a.evaluate(() => navigator.serviceWorker.ready);
    const paths = await cachedPaths(a);
    expect(paths.filter((p) => /procedimentos|vacinas|medicamentos|procedures|vaccines/.test(p))).toEqual([]);
  });

  await test.step("outra família e sem login: 404 / bloqueado", async () => {
    const ctxC = await browser.newContext();
    const c = await ctxC.newPage();
    await createFamily(c, "saude1b-c");
    expect((await c.request.get(procPath)).status()).toBe(404);
    expect((await c.request.get(vacPath)).status()).toBe(404);
    expect((await c.request.get(`/saude/arquivo/vacinas/${procId}`)).status()).toBe(404);
    expect((await c.request.get(`/saude/arquivo/medicamentos/${procId}`)).status()).toBe(404);
    expect((await c.request.get("/saude/arquivo/procedimentos/nao-e-uuid")).status()).toBe(404);
    await c.goto("/saude/procedimentos");
    await expect(c.getByText("Nenhum procedimento ainda.")).toBeVisible();
    await c.goto("/saude/vacinas");
    await expect(c.getByTestId("vacina")).toHaveCount(0);
    await ctxC.close();

    const anon = await browser.newContext();
    for (const path of [procPath, vacPath, "/saude/procedimentos", "/saude/medicamentos", "/saude/vacinas"]) {
      const res = await anon.request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers().location).toMatch(/\/login$/);
    }
    await anon.close();
  });

  await test.step("apagar vacina e procedimento remove os arquivos", async () => {
    const { data: v } = await adminClient().from("health_vaccines").select("household_id, file_path").eq("name", "Hepatite B").single();
    await a.goto("/saude/vacinas");
    await a.getByTestId("vacina").getByRole("button", { name: "Apagar" }).click();
    await a.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(a.getByText("Nenhuma vacina de Filho Teste ainda.")).toBeVisible();
    expect((await a.request.get(vacPath)).status()).toBe(404);
    const { data: vf } = await adminClient().storage.from("saude").list(`${v!.household_id}/vaccines`);
    expect(vf).toEqual([]);

    await a.goto("/saude/procedimentos");
    await a.getByTestId("procedimento").getByRole("button", { name: "Apagar" }).click();
    await a.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(a.getByText("Nenhum procedimento ainda.")).toBeVisible();
    expect((await a.request.get(procPath)).status()).toBe(404);
    const { data: pf } = await adminClient().storage.from("saude").list(`${v!.household_id}/procedures`);
    expect(pf).toEqual([]);
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/.test(p))).toEqual([]);
  await ctxA.close();
});
