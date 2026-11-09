import { expect, test, type Page } from "@playwright/test";
import { E2E_AGENDA_HOUSEHOLD_ID } from "../../playwright.config";
import { adminClient, createFamilyWithId } from "./admin";
import { PASSWORD, signUp, uniqueEmail, watchConsole } from "./helpers";

const MOCK = "http://127.0.0.1:4020";
const CARDS_CACHE = "oliveiras-carteirinhas-v1";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF"), Buffer.alloc(32), Buffer.from([0xff, 0xd9])]);
const pdf = { name: "carteirinha.pdf", mimeType: "application/pdf", buffer: PDF };
const jpg = { name: "carteirinha.jpg", mimeType: "image/jpeg", buffer: JPG };

/** Cria a família (titular) + dependente "Filho Teste" pela interface; devolve o código de convite. */
async function createFamily(page: Page, tag: string) {
  await signUp(page, uniqueEmail(tag));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/familia");
  await page.getByPlaceholder("Nome do dependente").fill("Filho Teste");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("Filho Teste")).toBeVisible();
  return (await page.locator("p.font-mono").innerText()).trim();
}

const cachedPaths = (page: Page) =>
  page.evaluate(async (name) => {
    if (!(await caches.has(name))) return [] as string[];
    const c = await caches.open(name);
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  }, CARDS_CACHE);

test("Saúde: carteirinhas, consultas e exames (família compartilhada, arquivos privados, offline)", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const problems = watchConsole(a);
  const code = await createFamily(a, "saude-a");

  let cardId = "";
  let cardPath = "";

  await test.step("carteirinha: recusa arquivo falso e acima de 5 MB; aceita PDF", async () => {
    await a.goto("/saude");
    await expect(a.getByText("Nenhuma carteirinha ainda.")).toBeVisible();
    await a.getByRole("button", { name: "Nova carteirinha" }).click();
    const d = a.getByRole("dialog", { name: "Nova carteirinha" });
    await d.getByLabel("Pessoa").selectOption({ label: "Filho Teste" });
    await d.getByLabel("Operadora").fill("Unimed Teste");
    await d.getByLabel("Número da carteirinha").fill("0123 4567");
    // Texto/HTML com nome e mime de PDF: o servidor olha os bytes.
    await d.getByLabel(/Arquivo \(PDF ou JPG/).setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await d.getByRole("button", { name: "Salvar carteirinha" }).click();
    await expect(d.getByText("Envie um arquivo PDF ou JPG.")).toBeVisible();
    await d.getByLabel(/Arquivo \(PDF ou JPG/).setInputFiles({ name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) });
    await d.getByRole("button", { name: "Salvar carteirinha" }).click();
    await expect(d.getByText("O arquivo passa de 5 MB.")).toBeVisible();
    await d.getByLabel(/Arquivo \(PDF ou JPG/).setInputFiles(pdf);
    await d.getByRole("button", { name: "Salvar carteirinha" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Carteirinha salva." })).toBeVisible();
    const card = a.getByRole("region", { name: "Carteirinhas de Filho Teste" }).getByTestId("carteirinha");
    await expect(card).toContainText("Unimed Teste");
    await expect(card).toContainText("0123 4567");
    cardPath = (await card.getByRole("link", { name: "Abrir PDF" }).getAttribute("href"))!;
    expect(cardPath).toMatch(/^\/saude\/arquivo\/carteirinhas\/[0-9a-f-]{36}$/);
    cardId = cardPath.split("/").pop()!;
  });

  await test.step("arquivo servido só por rota autenticada, com cabeçalhos seguros", async () => {
    const res = await a.request.get(cardPath);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["cache-control"]).toBe("private, no-store");
    expect(res.headers()["content-disposition"]).toBe('inline; filename="arquivo.pdf"');
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
    // Nada de URL pública no bucket.
    const { data } = await adminClient().from("health_insurance_cards").select("file_path, file_mime, file_size").eq("id", cardId).single();
    expect(data).toMatchObject({ file_mime: "application/pdf", file_size: PDF.length });
    expect(data!.file_path).toMatch(/^[0-9a-f-]{36}\/cards\/[0-9a-f-]{36}\.pdf$/);
    expect(data!.file_path).not.toContain("carteirinha");
    const pub = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/saude/${data!.file_path}`);
    expect(pub.status).toBeGreaterThanOrEqual(400);
  });

  await test.step("cônjuge entra pelo código e vê a mesma carteirinha (RLS por família)", async () => {
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await signUp(b, uniqueEmail("saude-b"));
    await b.getByRole("button", { name: "Entrar com código" }).click();
    await b.getByLabel("Código de convite").fill(code.toLowerCase());
    await b.getByLabel("Seu nome").fill("Karen");
    await b.getByRole("button", { name: "Entrar na família" }).click();
    await expect(b).toHaveURL(/\/inicio$/);
    await b.goto("/saude");
    await expect(b.getByTestId("carteirinha")).toContainText("Unimed Teste");
    expect((await b.request.get(cardPath)).status()).toBe(200);
    await ctxB.close();
  });

  await test.step("outra família e sem login: 404 / bloqueado", async () => {
    const ctxC = await browser.newContext();
    const c = await ctxC.newPage();
    await createFamily(c, "saude-c");
    expect((await c.request.get(cardPath)).status()).toBe(404);
    expect((await c.request.get(`/saude/arquivo/exames/${cardId}`)).status()).toBe(404);
    expect((await c.request.get(`/saude/arquivo/qualquer/${cardId}`)).status()).toBe(404);
    expect((await c.request.get("/saude/arquivo/carteirinhas/nao-e-uuid")).status()).toBe(404);
    await c.goto("/saude");
    await expect(c.getByText("Nenhuma carteirinha ainda.")).toBeVisible();
    await ctxC.close();

    const anon = await browser.newContext();
    const res = await anon.request.get(cardPath, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/login$/);
    await anon.close();
  });

  await test.step("offline: só o arquivo e o mínimo ficam no aparelho e abrem sem internet", async () => {
    await a.goto("/saude");
    await a.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => cachedPaths(a)).toEqual(expect.arrayContaining([cardPath, "/__offline/carteirinhas.json"]));
    const paths = await cachedPaths(a);
    expect(paths.filter((p) => p !== cardPath && p !== "/__offline/carteirinhas.json")).toEqual([]);
    const meta = await a.evaluate(async (name) => (await (await (await caches.open(name)).match("/__offline/carteirinhas.json"))!.json()) as { cards: Record<string, unknown>[] }, CARDS_CACHE);
    expect(Object.keys(meta.cards[0]).sort()).toEqual(["id", "mime", "number", "operator", "person", "updatedAt"]);
    expect(meta.cards[0]).toMatchObject({ operator: "Unimed Teste", person: "Filho Teste", number: "0123 4567" });

    await ctxA.setOffline(true);
    await a.goto("/offline-carteirinhas.html");
    await expect(a.getByRole("listitem").filter({ hasText: "Unimed Teste" })).toContainText("0123 4567");
    const offlineFile = await a.evaluate(async (p) => {
      const r = await fetch(p);
      return { status: r.status, type: r.headers.get("content-type") };
    }, cardPath);
    expect(offlineFile).toEqual({ status: 200, type: "application/pdf" });
    await ctxA.setOffline(false);
  });

  await test.step("editar: trocar por JPG apaga o PDF antigo do storage", async () => {
    await a.goto("/saude");
    const { data: before } = await adminClient().from("health_insurance_cards").select("household_id, file_path").eq("id", cardId).single();
    await a.getByTestId("carteirinha").getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar carteirinha" });
    await d.getByLabel("Plano").fill("Pleno");
    await d.getByLabel(/Trocar arquivo/).setInputFiles(jpg);
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Carteirinha atualizada." })).toBeVisible();
    const card = a.getByTestId("carteirinha");
    await expect(card).toContainText("Pleno");
    await expect(card.getByRole("img", { name: /Carteirinha Unimed Teste/ })).toBeVisible();
    const res = await a.request.get(cardPath);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
    expect(res.headers()["content-disposition"]).toBe('inline; filename="arquivo.jpg"');
    const { data: files } = await adminClient().storage.from("saude").list(`${before!.household_id}/cards`);
    expect(files!.map((f) => f.name)).toHaveLength(1);
    expect(files!.map((f) => `${before!.household_id}/cards/${f.name}`)).not.toContain(before!.file_path);
  });

  await test.step("apagar a carteirinha remove o arquivo e tira do cache offline", async () => {
    await a.getByTestId("carteirinha").getByRole("button", { name: "Remover" }).click();
    await a.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Remover" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Carteirinha removida." })).toBeVisible();
    await expect(a.getByText("Nenhuma carteirinha ainda.")).toBeVisible();
    await expect.poll(() => cachedPaths(a)).not.toContain(cardPath);
    expect((await a.request.get(cardPath)).status()).toBe(404);
    const { data } = await adminClient().from("health_insurance_cards").select("id").eq("id", cardId);
    expect(data).toEqual([]);
  });

  await test.step("consulta: cadastro, retorno vinculado, status e Agenda não sincronizada", async () => {
    await a.goto("/saude/consultas");
    await a.getByRole("button", { name: "Nova consulta" }).click();
    const d = a.getByRole("dialog", { name: "Nova consulta" });
    await d.getByLabel("Pessoa").selectOption({ label: "Filho Teste" });
    await d.getByLabel("Especialidade").fill("Cardiologia");
    await d.getByLabel("Médico").fill("Dra. Ana");
    await d.getByLabel("Local").fill("Clínica Central");
    await d.getByLabel("Data e hora").fill("2099-05-10T14:30");
    await d.getByRole("button", { name: "Salvar" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Consulta salva." })).toBeVisible();
    const next = a.getByRole("region", { name: "Próximas consultas" });
    const item = next.getByTestId("consulta");
    await expect(item).toContainText("Consulta — Cardiologia");
    await expect(item).toContainText("10/05/2099 às 14:30");
    // Google não conectado: a consulta fica salva e avisa.
    await expect(item).toContainText("Não sincronizada com a Agenda");
    await expect(item.getByRole("button", { name: "Tentar de novo" })).toBeVisible();

    await item.getByRole("button", { name: "Marcar retorno" }).click();
    const r = a.getByRole("dialog", { name: "Nova consulta" });
    await expect(r.getByLabel("Tipo")).toHaveValue("retorno");
    await expect(r.getByLabel("Especialidade")).toHaveValue("Cardiologia");
    await expect(r.getByLabel("Retorno de qual consulta?")).not.toHaveValue("");
    await r.getByLabel("Data e hora").fill("2099-06-10T09:00");
    await r.getByRole("button", { name: "Salvar" }).click();
    await expect(next.getByTestId("consulta").filter({ hasText: "Retorno — Cardiologia" })).toContainText("Retorno de Cardiologia — 10/05/2099 às 14:30");

    await next.getByTestId("consulta").filter({ hasText: "Consulta — Cardiologia" }).getByRole("button", { name: "Marcar como realizada" }).click();
    const past = a.getByRole("region", { name: "Consultas passadas" });
    await expect(past.getByTestId("consulta")).toContainText("Realizada");
    await expect(next.getByTestId("consulta")).toHaveCount(1);

    // Apagar com confirmação.
    await next.getByTestId("consulta").getByRole("button", { name: "Apagar" }).click();
    await next.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(next.getByTestId("consulta")).toHaveCount(0);
  });

  await test.step("exame: resumo, PDF opcional anexado depois, apagar remove o arquivo", async () => {
    await a.goto("/saude/exames");
    await a.getByRole("button", { name: "Novo exame" }).click();
    const d = a.getByRole("dialog", { name: "Novo exame" });
    await d.getByLabel("Exame", { exact: true }).fill("Hemograma <b>completo</b>");
    await d.getByLabel("Data").fill("2026-10-05");
    await d.getByLabel("Resumo do resultado").fill("Tudo dentro do normal.");
    await d.getByRole("button", { name: "Salvar exame" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Exame salvo." })).toBeVisible();
    const ex = a.getByTestId("exame");
    // Texto do usuário sempre como texto.
    await expect(ex).toContainText("Hemograma <b>completo</b>");
    await expect(ex).toContainText("Tudo dentro do normal.");
    await expect(ex.getByRole("link", { name: "Abrir PDF" })).toHaveCount(0);

    await ex.getByRole("button", { name: "Editar" }).click();
    const e = a.getByRole("dialog", { name: "Editar exame" });
    await e.getByLabel(/Arquivo opcional/).setInputFiles(pdf);
    await e.getByRole("button", { name: "Salvar alterações" }).click();
    const link = ex.getByRole("link", { name: "Abrir PDF" });
    await expect(link).toBeVisible();
    const path = (await link.getAttribute("href"))!;
    expect(path).toMatch(/^\/saude\/arquivo\/exames\//);
    const res = await a.request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    // Exame não vai para o cache offline.
    expect(await cachedPaths(a)).not.toContain(path);

    await ex.getByRole("button", { name: "Apagar" }).click();
    await a.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(a.getByText("Nenhum exame ainda.")).toBeVisible();
    expect((await a.request.get(path)).status()).toBe(404);
  });

  await test.step("sair da conta apaga as carteirinhas do aparelho", async () => {
    await a.goto("/saude");
    await a.getByRole("button", { name: "Nova carteirinha" }).click();
    const d = a.getByRole("dialog", { name: "Nova carteirinha" });
    await d.getByLabel("Operadora").fill("Bradesco Saúde");
    await d.getByLabel(/Arquivo \(PDF ou JPG/).setInputFiles(pdf);
    await d.getByRole("button", { name: "Salvar carteirinha" }).click();
    await expect(a.getByTestId("carteirinha")).toContainText("Bradesco Saúde");
    await expect.poll(async () => (await cachedPaths(a)).length).toBe(2);
    await a.goto("/familia");
    await a.getByRole("button", { name: "Sair" }).click();
    await expect(a).toHaveURL(/\/login$/);
    await expect.poll(() => a.evaluate((n) => caches.has(n), CARDS_CACHE)).toBe(false);
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/.test(p))).toEqual([]);
  await ctxA.close();
});

// Usa a mesma família e o mesmo Google simulado da spec da Agenda (a Agenda só vale para uma família):
// rode isolada, com E2E_SAUDE_AGENDA=1 (as duas specs juntas se atropelariam).
test("Saúde: consulta agendada vira evento na Agenda e acompanha edição, cancelamento e exclusão", async ({ page }) => {
  test.skip(process.env.E2E_SAUDE_AGENDA !== "1", "Compartilha família/mock com agenda.spec.ts; rode com E2E_SAUDE_AGENDA=1 e --workers=1.");
  test.setTimeout(180_000);
  await fetch(`${MOCK}/__reset`, { method: "POST" });
  await fetch(`${MOCK}/__user`, { method: "POST", body: JSON.stringify({ user: "gabriel" }) });
  const email = uniqueEmail("saude-g");
  await createFamilyWithId(E2E_AGENDA_HOUSEHOLD_ID, email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  const events = async () =>
    (await (await fetch(`${MOCK}/__events/${encodeURIComponent("gabriel.e2e@gmail.com")}`)).json()) as { id: string; summary: string; status: string; location?: string }[];

  await page.goto("/agenda");
  await page.getByRole("link", { name: "Conectar Google" }).click();
  await expect(page).toHaveURL(/\/agenda\?google=conectado$/);

  await page.goto("/saude/consultas");
  await page.getByRole("button", { name: "Nova consulta" }).click();
  const d = page.getByRole("dialog", { name: "Nova consulta" });
  await d.getByLabel("Especialidade").fill("Cardiologia");
  await d.getByLabel("Local").fill("Clínica Central");
  await d.getByLabel("Data e hora").fill("2099-05-10T14:30");
  await d.getByRole("button", { name: "Salvar" }).click();
  const item = page.getByRole("region", { name: "Próximas consultas" }).getByTestId("consulta");
  await expect(item).toContainText("Consulta — Cardiologia");
  await expect(item).not.toContainText("Não sincronizada com a Agenda");
  const created = (await events()).find((e) => e.summary === "Consulta — Cardiologia (Gabriel)");
  expect(created?.location).toBe("Clínica Central");

  await item.getByRole("button", { name: "Editar" }).click();
  const e = page.getByRole("dialog", { name: "Editar consulta" });
  await e.getByLabel("Especialidade").fill("Ortopedia");
  await e.getByRole("button", { name: "Salvar alterações" }).click();
  await expect.poll(async () => (await events()).some((x) => x.summary === "Consulta — Ortopedia (Gabriel)")).toBe(true);

  await item.getByRole("button", { name: "Cancelar consulta" }).click();
  await expect.poll(async () => (await events()).find((x) => x.id === created!.id)?.status).toBe("cancelled");
});
