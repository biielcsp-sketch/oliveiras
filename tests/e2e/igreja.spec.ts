import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_IGREJA_HOUSEHOLD_ID } from "../../playwright.config";
import { addSpouse, adminClient, createFamilyWithId } from "./admin";
import { PASSWORD, uniqueEmail, watchConsole } from "./helpers";

const DRIVE = "http://127.0.0.1:4040";
const G_GOOGLE = "gabriel.igreja.e2e@gmail.com";
const K_GOOGLE = "karen.igreja.e2e@gmail.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type MockFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  appProperties: Record<string, string>;
  owner: string;
  permissions: { id: string; type: string; role: string; emailAddress: string }[];
};
const driveFiles = async () => (await (await fetch(`${DRIVE}/__files`)).json()) as MockFile[];

async function expectNoHorizontalScroll(page: Page) {
  const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(scroll, "página mais larga que a tela").toBeLessThanOrEqual(view);
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

/** Usuário do Google simulado deste navegador (cookie lido pelo google-mock; não disputa com a Agenda em paralelo). */
async function googleAs(ctx: BrowserContext, user: string, denyDrive = false) {
  await ctx.clearCookies({ domain: "127.0.0.1" });
  const cookies = [{ name: "mock_user", value: user, domain: "127.0.0.1", path: "/" }];
  if (denyDrive) cookies.push({ name: "mock_deny_drive", value: "1", domain: "127.0.0.1", path: "/" });
  await ctx.addCookies(cookies);
}


/** Captura de tela 390px só quando SHOTS_DIR está definido (revisão visual); sem a variável não faz nada. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Seleciona um trecho do caderno (como o usuário com o dedo ou o mouse). */
async function selectIn(ta: ReturnType<Page["getByLabel"]>, word: string) {
  await ta.evaluate((el: HTMLTextAreaElement, w: string) => {
    const i = el.value.indexOf(w);
    el.focus();
    el.setSelectionRange(i, i + w.length);
    el.dispatchEvent(new Event("select", { bubbles: true }));
  }, word);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\nConteúdo da aula de Cristologia\n%%EOF\n");

test("Igreja: devocional pessoal com compartilhamento, Carisma com Google Drive e resumo, Consolidação", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  const gEmail = uniqueEmail("igreja-g");
  const kEmail = uniqueEmail("igreja-k");
  await createFamilyWithId(E2E_IGREJA_HOUSEHOLD_ID, gEmail, PASSWORD);
  await addSpouse(E2E_IGREJA_HOUSEHOLD_ID, kEmail, PASSWORD, "Karen");
  const admin = adminClient();
  const karenCtx = await browser.newContext();
  const karen = await karenCtx.newPage();

  await test.step("sem login: Igreja e Carisma vão para o login", async () => {
    const anon = await browser.newContext();
    const p = await anon.newPage();
    await p.goto("/ministerio/devocional");
    await expect(p).toHaveURL(/\/login/);
    await p.goto("/ministerio/carisma");
    await expect(p).toHaveURL(/\/login/);
    await anon.close();
  });

  await login(page, gEmail);

  await test.step("Resumo abre selecionado no centro da ferradura", async () => {
    await page.goto("/ministerio");
    const arc = page.getByRole("navigation", { name: "Seções de Igreja" });
    await expect(arc.locator('[aria-current="page"]')).toContainText("Resumo");
    await expect(page.getByTestId("igreja-resumo-oracoes")).toContainText("Nenhuma oração em andamento");
    // Regressão: o texto com truncate alargava a grade e a página rolava para os lados
    await expectNoHorizontalScroll(page);
  });

  await test.step("anotações: uma privada e uma compartilhada", async () => {
    await page.goto("/ministerio/devocional");
    await expect(page.getByRole("link", { name: "Anotações" })).toHaveAttribute("aria-current", "page");
    for (const [title, share] of [
      ["Palavra privada", false],
      ["Palavra para a família", true],
    ] as const) {
      await page.getByRole("button", { name: "Nova anotação" }).click();
      const d = page.getByRole("dialog");
      await d.getByLabel("Título (opcional)").fill(title);
      await d.getByLabel("O que o Senhor falou").fill(`Linha 1 de ${title}\nLinha 2 <b>sem html</b>`);
      if (share) await d.getByLabel(/Compartilhar com a família/).check();
      await d.getByRole("button", { name: "Salvar anotação" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Anotação salva." })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    const card = page.getByTestId("anotacao").filter({ hasText: "Palavra privada" });
    // Texto puro: a tag aparece como texto, e a quebra de linha é preservada pelo CSS.
    await expect(card.getByText("<b>sem html</b>", { exact: false })).toBeVisible();
    await expect(card.locator("b")).toHaveCount(0);
    await expect(page.getByTestId("anotacao").filter({ hasText: "Palavra para a família" })).toContainText("Compartilhado com a família");
  });

  await test.step("promessa marcada como cumprida", async () => {
    await page.getByRole("link", { name: "Promessas" }).click();
    await page.getByRole("button", { name: "Nova promessa" }).click();
    const d = page.getByRole("dialog");
    await d.getByRole("textbox", { name: "A promessa" }).fill("Eu te darei descanso");
    await d.getByLabel("Referência (opcional)").fill("Mateus 11:28");
    await d.getByRole("button", { name: "Salvar promessa" }).click();
    const card = page.getByTestId("promessa").filter({ hasText: "Eu te darei descanso" });
    await expect(card).toContainText("Aguardando o cumprimento");
    await card.getByRole("button", { name: "Marcar como cumprida" }).click();
    await card.getByRole("button", { name: "Confirmar" }).click();
    await expect(card).toContainText("Cumprida em");
  });

  await test.step("oração respondida com testemunho e filtro", async () => {
    await page.getByRole("link", { name: "Orações" }).click();
    await page.getByRole("button", { name: "Nova oração" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Motivo da oração").fill("Saúde da Dona Maria");
    await d.getByLabel("Por quem (opcional)").fill("Dona Maria");
    await d.getByRole("button", { name: "Salvar oração" }).click();
    await expect(page.getByTestId("oracao").filter({ hasText: "Saúde da Dona Maria" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Nova oração" }).click();
    await page.getByRole("dialog").getByLabel("Motivo da oração").fill("Emprego novo");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar oração" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Orando (2)" })).toBeVisible();
    const card = page.getByTestId("oracao").filter({ hasText: "Saúde da Dona Maria" });
    await card.getByRole("button", { name: "Marcar como respondida" }).click();
    await card.getByLabel("Testemunho (opcional)").fill("Recebeu alta!");
    await card.getByRole("button", { name: "Confirmar resposta" }).click();
    await expect(page.getByRole("button", { name: "Orando (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Respondidas (1)" }).click();
    await expect(page.getByTestId("oracao").filter({ hasText: "Saúde da Dona Maria" })).toContainText("Recebeu alta!");
  });

  await test.step("propósito em andamento aparece no Resumo", async () => {
    await page.getByRole("link", { name: "Propósitos" }).click();
    await page.getByRole("button", { name: "Novo propósito" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Propósito", { exact: true }).fill("Jejum de Daniel");
    await d.getByLabel("Situação").selectOption("em_andamento");
    await d.getByLabel("Início").fill("2026-11-01");
    await d.getByLabel("Término").fill("2026-10-01");
    await d.getByRole("button", { name: "Salvar propósito" }).click();
    await expect(d.getByText("O término não pode ser antes do início.")).toBeVisible();
    await d.getByLabel("Término").fill("2026-11-21");
    await d.getByRole("button", { name: "Salvar propósito" }).click();
    await expect(page.getByRole("region", { name: "Em andamento" }).getByTestId("proposito")).toContainText("Jejum de Daniel");
    await page.goto("/ministerio");
    await expect(page.getByTestId("igreja-resumo-oracoes")).toContainText("1 oração em andamento");
    await expect(page.getByTestId("igreja-resumo-propositos")).toContainText("1 propósito em andamento");
    await expect(page.getByTestId("igreja-resumo-anotacao")).toContainText("Palavra para a família");
    await expectNoHorizontalScroll(page);
  });

  await test.step("cônjuge não vê o privado e vê o compartilhado sem editar", async () => {
    await login(karen, kEmail);
    await karen.goto("/ministerio/devocional");
    await expect(karen.getByTestId("anotacao").filter({ hasText: "Palavra para a família" })).toContainText("compartilhado por Gabriel");
    await expect(karen.getByText("Palavra privada")).toHaveCount(0);
    const shared = karen.getByTestId("anotacao").filter({ hasText: "Palavra para a família" });
    await expect(shared.getByRole("button", { name: "Editar" })).toHaveCount(0);
    await expect(shared.getByRole("button", { name: "Apagar" })).toHaveCount(0);
    await karen.goto("/ministerio/devocional/oracoes");
    await expect(karen.getByTestId("oracao")).toHaveCount(0); // orações do Gabriel são privadas
    // RLS também barra direto no banco com a sessão da Karen: a anotação privada não existe para ela.
    const { count } = await admin.from("igreja_words").select("id", { count: "exact", head: true }).eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).eq("title", "Palavra privada");
    expect(count).toBe(1);
  });

  let lessonUrl = "";
  await test.step("Carisma: conta Google sem o Drive pede 'Conectar Google Drive' (escopo extra)", async () => {
    await page.goto("/ministerio/carisma");
    const banner = page.getByTestId("drive-banner");
    await expect(banner).toContainText("Conecte sua conta Google");
    await googleAs(page.context(), "ig-gabriel", true);
    await banner.getByRole("link", { name: "Conectar conta Google" }).click();
    await expect(page).toHaveURL(/\/ministerio\/carisma\?google=sem-drive$/);
    await expect(page.getByTestId("drive-banner")).toContainText("Falta conectar o Google Drive");
    const { data: acc } = await admin.from("google_accounts").select("email, scopes").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    expect(acc?.email).toBe(G_GOOGLE);
    expect(acc?.scopes).not.toContain(DRIVE_SCOPE);

    await googleAs(page.context(), "ig-gabriel");
    await page.getByTestId("drive-banner").getByRole("link", { name: "Conectar Google Drive" }).click();
    await expect(page).toHaveURL(/\/ministerio\/carisma\?google=conectado$/);
    await expect(page.getByText("Google Drive conectado.")).toBeVisible();
    await expect(page.getByTestId("drive-banner")).toHaveCount(0);
    const { data: acc2 } = await admin.from("google_accounts").select("scopes").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    expect(acc2?.scopes).toContain(DRIVE_SCOPE);
  });

  await test.step("nova aula", async () => {
    await page.getByRole("button", { name: "Nova aula" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Título da aula").fill("Introdução à Cristologia");
    await d.getByLabel("Disciplina").fill("Teologia Sistemática");
    await d.getByLabel("Professor").fill("Pr. João");
    await d.getByLabel("Anotações").fill("Jesus é o Verbo encarnado.\nJoão 1:14 <b>x</b>");
    await d.getByRole("button", { name: "Salvar aula" }).click();
    await expect(page).toHaveURL(/\/ministerio\/carisma\/[0-9a-f-]{36}$/);
    lessonUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: "Introdução à Cristologia" })).toBeVisible();
    await expect(page.getByText(".doc (Word antigo) não é aceito")).toBeVisible();
  });

  await test.step("upload direto ao Drive (prepare → PUT → confirm) de um PDF pequeno", async () => {
    const puts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT") puts.push(r.url());
    });
    await page.getByLabel("Escolher PDF").setInputFiles({ name: "apostila.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByRole("status").filter({ hasText: "Arquivo guardado no seu Google Drive." })).toBeVisible();
    const card = page.getByTestId("arquivo-aula").filter({ hasText: "apostila.pdf" });
    // Lista compacta: o arquivo ocupa uma linha só; as ações ficam no "⋯"
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(64);
    await expect(card.getByRole("link", { name: /Abrir no Drive/ })).toHaveCount(0);
    const acoes = card.getByRole("button", { name: "Ações de apostila.pdf" });
    await expect(acoes).toHaveAttribute("aria-expanded", "false");
    await acoes.click();
    await expect(acoes).toHaveAttribute("aria-expanded", "true");
    await expect(card.getByRole("link", { name: /Abrir no Drive/ })).toHaveAttribute("href", /^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/);
    await expect(card.getByRole("link", { name: /Abrir no Drive/ })).toHaveAttribute("target", "_blank");
    for (const n of ["Renomear", "Apagar"]) await expect(card.getByRole("button", { name: n })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(acoes).toHaveAttribute("aria-expanded", "false");
    await expect(acoes).toBeFocused();
    // Arquivos ficam no fim da tela (depois do resumo da aula)
    const resumoY = (await page.getByRole("region", { name: "Resumo da aula" }).boundingBox())!.y;
    expect((await page.getByRole("region", { name: "Arquivos da aula" }).boundingBox())!.y).toBeGreaterThan(resumoY);
    // O arquivo foi do navegador direto para o Drive (simulado), não para o servidor do app.
    expect(puts.length).toBe(1);
    expect(puts[0]).toMatch(/^http:\/\/127\.0\.0\.1:4040\/upload\/drive\/v3\/files\?uploadType=resumable&upload_id=/);

    const { data: rows } = await admin.from("igreja_carisma_files").select("id, status, file_size, drive_file_id, web_view_link, display_name").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ status: "pronto", file_size: PDF.length, display_name: "apostila.pdf" });
    const files = await driveFiles();
    const f = files.find((x) => x.id === rows![0].drive_file_id)!;
    expect(f).toMatchObject({ trashed: false, owner: G_GOOGLE, appProperties: { oliFile: rows![0].id } });
    // Pastas "Oliveira's" → "Carisma" → aula.
    const lessonFolder = files.find((x) => x.id === f.parents[0])!;
    const carisma = files.find((x) => x.id === lessonFolder.parents[0])!;
    const root = files.find((x) => x.id === carisma.parents[0])!;
    expect([root.name, carisma.name]).toEqual(["Oliveira's", "Carisma"]);
    expect(lessonFolder.name).toContain("Introdução à Cristologia");
  });

  await test.step("arquivo falso (HTML com nome .pdf) é recusado e vai para a lixeira do Drive", async () => {
    await page.getByLabel("Escolher PDF").setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await expect(page.getByText("não é um texto (.txt), Word (.docx), PDF ou imagem JPG/PNG válido e foi descartado")).toBeVisible();
    await expect(page.getByTestId("arquivo-aula").filter({ hasText: "falso.pdf" })).toHaveCount(0);
    const fake = (await driveFiles()).find((x) => x.name === "falso.pdf");
    expect(fake?.trashed).toBe(true);
    const { count } = await admin.from("igreja_carisma_files").select("id", { count: "exact", head: true }).eq("household_id", E2E_IGREJA_HOUSEHOLD_ID);
    expect(count).toBe(1);
  });

  await test.step("arquivos em lista: renomear muda no app e no Drive e mantém a extensão", async () => {
    const item = page.getByRole("list", { name: "Lista de arquivos" }).getByTestId("arquivo-aula").filter({ hasText: "apostila.pdf" });
    await item.getByRole("button", { name: "Ações de apostila.pdf" }).click();
    await item.getByRole("button", { name: "Renomear" }).click();
    const d = page.getByRole("dialog", { name: "Renomear arquivo" });
    await expect(d.getByLabel("Novo nome")).toHaveValue("apostila");
    await d.getByLabel("Novo nome").fill("   ");
    await d.getByRole("button", { name: "Salvar nome" }).click();
    await expect(d.getByText("Digite o novo nome do arquivo.")).toBeVisible();
    await d.getByLabel("Novo nome").fill("Apostila da aula 1");
    await d.getByRole("button", { name: "Salvar nome" }).click();
    await expect(d).toBeHidden();
    await expect(page.getByTestId("arquivo-aula").filter({ hasText: "Apostila da aula 1.pdf" })).toBeVisible();
    const { data: row } = await admin.from("igreja_carisma_files").select("display_name, drive_file_id").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    expect(row?.display_name).toBe("Apostila da aula 1.pdf");
    expect((await driveFiles()).find((x) => x.id === row!.drive_file_id)?.name).toBe("Apostila da aula 1.pdf");
  });

  await test.step(".doc antigo é recusado na tela com explicação", async () => {
    await page.getByLabel("Escolher arquivo de texto").setInputFiles({ name: "antigo.doc", mimeType: "application/msword", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) });
    await expect(page.getByText("Arquivo .doc (Word antigo) não é aceito. Abra no Word")).toBeVisible();
  });

  await test.step("caderno: formatar na seleção, atalhos, pré-visualização, autosave e persistência", async () => {
    const caderno = page.getByRole("region", { name: "Caderno de anotações" });
    const ta = caderno.getByLabel("Anotações da aula");
    await expect(ta).toHaveValue("Jesus é o Verbo encarnado.\nJoão 1:14 <b>x</b>");
    await expect(caderno.getByTestId("notas-status")).toContainText("Salvo");
    // barra de ferramentas ABAIXO da caixa de texto, com botões nomeados
    const bar = caderno.getByRole("toolbar", { name: "Formatação do caderno" });
    expect((await bar.boundingBox())!.y).toBeGreaterThan((await ta.boundingBox())!.y + (await ta.boundingBox())!.height - 1);
    for (const n of ["Negrito", "Itálico", "Sublinhado", "Marca-texto", "Título", "Lista", "Desfazer", "Refazer"]) await expect(bar.getByRole("button", { name: n })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Desfazer" })).toBeDisabled();

    await selectIn(ta, "Verbo");
    await bar.getByRole("button", { name: "Negrito" }).click();
    await expect(ta).toHaveValue("Jesus é o **Verbo** encarnado.\nJoão 1:14 <b>x</b>");
    await expect(bar.getByRole("button", { name: "Negrito" })).toHaveAttribute("aria-pressed", "true");
    await expect(caderno.getByTestId("notas-status")).toContainText("Alterações não salvas");
    // atalho Ctrl+I no trecho selecionado
    await selectIn(ta, "encarnado");
    await page.keyboard.press("Control+i");
    await expect(ta).toHaveValue("Jesus é o **Verbo** _encarnado_.\nJoão 1:14 <b>x</b>");
    await selectIn(ta, "Jesus");
    await bar.getByRole("button", { name: "Marca-texto" }).click();
    await bar.getByRole("button", { name: "Sublinhado" }).click();
    await selectIn(ta, "Jesus");
    await bar.getByRole("button", { name: "Título" }).click();
    await expect(ta).toHaveValue("# ==++Jesus++== é o **Verbo** _encarnado_.\nJoão 1:14 <b>x</b>");
    await selectIn(ta, "João");
    await bar.getByRole("button", { name: "Lista" }).click();
    await expect(ta).toHaveValue("# ==++Jesus++== é o **Verbo** _encarnado_.\n- João 1:14 <b>x</b>");
    // desfazer / refazer (botão e atalho)
    await bar.getByRole("button", { name: "Desfazer" }).click();
    await expect(ta).toHaveValue("# ==++Jesus++== é o **Verbo** _encarnado_.\nJoão 1:14 <b>x</b>");
    await bar.getByRole("button", { name: "Refazer" }).click();
    await expect(ta).toHaveValue("# ==++Jesus++== é o **Verbo** _encarnado_.\n- João 1:14 <b>x</b>");

    // pré-visualização: elementos reais, HTML digitado só como texto
    await bar.getByRole("button", { name: "Pré-visualizar" }).click();
    const prev = caderno.getByTestId("notas-previa");
    await expect(prev.locator("h4 mark u")).toHaveText("Jesus");
    await expect(prev.locator("strong")).toHaveText("Verbo");
    await expect(prev.locator("em")).toHaveText("encarnado");
    await expect(prev.locator("li")).toContainText("João 1:14 <b>x</b>");
    await expect(prev.locator("b, script")).toHaveCount(0);
    await shot(page, "01-aula-caderno-barra");

    // autosave com debounce: "Salvo" e persistido
    await expect(caderno.getByTestId("notas-status")).toContainText("Salvo", { timeout: 10_000 });
    const { data: row } = await admin.from("igreja_carisma_lessons").select("notes").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    expect(row?.notes).toBe("# ==++Jesus++== é o **Verbo** _encarnado_.\n- João 1:14 <b>x</b>");
    await page.reload();
    await expect(page.getByLabel("Anotações da aula")).toHaveValue("# ==++Jesus++== é o **Verbo** _encarnado_.\n- João 1:14 <b>x</b>");

    // limite de 10000 contando a marcação: o contador mostra e a formatação que estoura é bloqueada
    const ta2 = page.getByLabel("Anotações da aula");
    await ta2.fill("a".repeat(10000));
    await expect(page.getByTestId("notas-contador")).toContainText("10000/10000");
    await selectIn(ta2, "a");
    await page.getByRole("button", { name: "Negrito" }).click();
    await expect(page.getByTestId("notas-contador")).toContainText("Limite de 10000 caracteres");
    expect(await ta2.inputValue()).toBe("a".repeat(10000));
    await expect(page.getByTestId("notas-status")).toContainText("Salvo", { timeout: 10_000 });
    const { data: full } = await admin.from("igreja_carisma_lessons").select("notes").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    expect(full?.notes).toHaveLength(10000);
    await ta2.fill("Jesus é o Verbo encarnado.\nJoão 1:14");
    await expect(page.getByTestId("notas-status")).toContainText("Salvo", { timeout: 10_000 });
  });

  await test.step("anexos Texto, Imagem e PDF: .txt e .png entram; binário disfarçado de .txt é recusado", async () => {
    const group = page.getByRole("group", { name: "Adicionar arquivo" });
    for (const n of ["Texto", "Imagem", "PDF"]) await expect(group.getByRole("button", { name: n, exact: true })).toBeVisible();
    await shot(page, "02-anexos-texto-imagem-pdf");
    await page.getByLabel("Escolher arquivo de texto").setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("Texto da aula: o Verbo se fez carne.", "utf8") });
    await expect(page.getByTestId("arquivo-aula").filter({ hasText: "notas.txt" })).toBeVisible();
    await page.getByLabel("Escolher imagem").setInputFiles({ name: "quadro.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("arquivo-aula").filter({ hasText: "quadro.png" })).toBeVisible();
    const { data: rows } = await admin.from("igreja_carisma_files").select("display_name, file_mime, status").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).order("display_name");
    expect(rows?.map((r) => [r.display_name, r.file_mime, r.status])).toEqual([
      ["Apostila da aula 1.pdf", "application/pdf", "pronto"],
      ["notas.txt", "text/plain", "pronto"],
      ["quadro.png", "image/png", "pronto"],
    ]);
    // binário com nome .txt (assinatura PNG) e arquivo com byte nulo: recusados pelos bytes
    await page.getByLabel("Escolher arquivo de texto").setInputFiles({ name: "falso.txt", mimeType: "text/plain", buffer: PNG });
    await expect(page.getByText("não é um texto (.txt), Word (.docx), PDF ou imagem JPG/PNG válido e foi descartado")).toBeVisible();
    await expect(page.getByTestId("arquivo-aula").filter({ hasText: "falso.txt" })).toHaveCount(0);
    expect((await driveFiles()).find((x) => x.name === "falso.txt")?.trashed).toBe(true);
    const { count } = await admin.from("igreja_carisma_files").select("id", { count: "exact", head: true }).eq("household_id", E2E_IGREJA_HOUSEHOLD_ID);
    expect(count).toBe(3);
  });

  let studyCalls = 0;
  await test.step("Estudar com o Oli: lê anotações e arquivos; só grava no caderno depois de confirmar", async () => {
    const ta = page.getByLabel("Anotações da aula");
    // texto ainda não salvo é salvo antes de o Oli ler
    await ta.fill("Jesus é o Verbo encarnado.\nJoão 1:14 extra-novo");
    await page.getByRole("button", { name: "Estudar com o Oli" }).click();
    const d = page.getByRole("dialog", { name: "Estudar com o Oli" });
    for (const n of ["Resumir a aula", "Perguntas de reflexão", "Fazer um teste"]) await expect(d.getByRole("button", { name: n })).toBeVisible();
    await shot(page, "03-estudar-com-o-oli");
    await d.getByRole("button", { name: "Fazer um teste" }).click();
    studyCalls++;
    const resposta = d.getByTestId("oli-resposta");
    await expect(resposta).toContainText("Modo quiz", { timeout: 30_000 });
    await expect(resposta).toContainText("extra-novo");
    await expect(resposta).toContainText("notas.txt=Texto da aula: o Verbo se fez carne.");
    await expect(resposta).toContainText("Inline: 2"); // PDF + PNG
    await d.getByRole("button", { name: "Perguntas de reflexão" }).click();
    studyCalls++;
    await expect(resposta).toContainText("Modo reflexao", { timeout: 30_000 });
    await d.getByLabel("Pergunta sobre a aula").fill("Quem é o Verbo?");
    await d.getByRole("button", { name: "Enviar pergunta" }).click();
    studyCalls++;
    await expect(resposta).toContainText("Pergunta: Quem é o Verbo?", { timeout: 30_000 });
    await expect(resposta).toContainText("Modo pergunta");

    // propor → mostrar o texto → cancelar não grava
    const before = "Jesus é o Verbo encarnado.\nJoão 1:14 extra-novo";
    const notesInDb = async () => (await admin.from("igreja_carisma_lessons").select("notes").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single()).data?.notes;
    await d.getByRole("button", { name: "Anotar no caderno" }).click();
    const conf = d.getByRole("group", { name: "Confirmar anotação no caderno" });
    await expect(conf.getByLabel("Texto proposto para o caderno")).toHaveValue(/Modo pergunta/);
    await shot(page, "04-oli-confirmar-anotacao");
    expect(await notesInDb()).toBe(before);
    await conf.getByRole("button", { name: "Cancelar" }).click();
    await expect(conf).toHaveCount(0);
    expect(await notesInDb()).toBe(before);
    // propor de novo, editar e confirmar: só então grava (ao fim do caderno)
    await d.getByRole("button", { name: "Anotar no caderno" }).click();
    await conf.getByLabel("Texto proposto para o caderno").fill("- O Verbo é Jesus (João 1:1)");
    await conf.getByRole("button", { name: "Confirmar e anotar" }).click();
    await expect(d.getByText("Anotado no caderno.")).toBeVisible();
    await expect.poll(notesInDb).toBe(before + "\n\n- O Verbo é Jesus (João 1:1)");
    await page.keyboard.press("Escape");
    await expect(ta).toHaveValue(before + "\n\n- O Verbo é Jesus (João 1:1)");
    // cada pedido ao Oli conta no limite diário da família
    const { count: logged } = await admin.from("igreja_summary_log").select("id", { count: "exact", head: true }).eq("household_id", E2E_IGREJA_HOUSEHOLD_ID);
    expect(logged).toBe(studyCalls);
    // limpa os anexos extras (vão para a lixeira do Drive) para os passos seguintes
    for (const n of ["notas.txt", "quadro.png"]) {
      const item = page.getByTestId("arquivo-aula").filter({ hasText: n });
      await item.getByRole("button", { name: `Ações de ${n}` }).click();
      await item.getByRole("button", { name: "Apagar" }).click();
      const confirmar = item.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" });
      // a barra inferior fixa cobre o fim da lista: centraliza o botão antes de tocar
      await confirmar.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await confirmar.click();
      await expect(item).toHaveCount(0);
    }
  });

  await test.step("compartilhar a aula: sem Google da Karen avisa; depois dá leitura na pasta para o e-mail dela", async () => {
    await page.getByRole("region", { name: "Compartilhamento" }).getByLabel(/Compartilhar com a família/).check();
    await expect(page.getByText("Karen ainda não conectou o Google").first()).toBeVisible();

    await googleAs(karenCtx, "ig-karen");
    await karen.goto("/ministerio/carisma");
    await karen.getByTestId("drive-banner").getByRole("link", { name: "Conectar conta Google" }).click();
    await expect(karen).toHaveURL(/\/ministerio\/carisma\?google=conectado$/);

    await page.reload();
    await page.getByRole("button", { name: "Atualizar acesso aos arquivos" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Acesso aos arquivos atualizado." })).toBeVisible();
    const { data: lesson } = await admin.from("igreja_carisma_lessons").select("drive_folder_id, shared").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    expect(lesson?.shared).toBe(true);
    const folder = (await driveFiles()).find((x) => x.id === lesson!.drive_folder_id)!;
    expect(folder.permissions.filter((p) => p.emailAddress === K_GOOGLE)).toEqual([expect.objectContaining({ role: "reader", type: "user" })]);
  });

  await test.step("Karen vê a aula compartilhada só para leitura", async () => {
    await karen.goto("/ministerio/carisma");
    await expect(karen.getByTestId("aula").filter({ hasText: "Introdução à Cristologia" })).toContainText("compartilhado por Gabriel");
    await karen.goto(lessonUrl);
    await expect(karen.getByText("compartilhado por Gabriel")).toBeVisible();
    await karen.getByTestId("arquivo-aula").getByRole("button", { name: /^Ações de / }).click();
    await expect(karen.getByTestId("arquivo-aula").getByRole("link", { name: /Abrir no Drive/ })).toBeVisible();
    await expect(karen.getByTestId("arquivo-aula").getByRole("button", { name: "Renomear" })).toHaveCount(0);
    await expect(karen.getByRole("button", { name: "Editar aula" })).toHaveCount(0);
    await expect(karen.getByRole("button", { name: "Resumir aula" })).toHaveCount(0);
    await expect(karen.getByLabel("Escolher PDF")).toHaveCount(0);
    await expect(karen.getByLabel("Anotações da aula")).toHaveCount(0);
    await expect(karen.getByRole("button", { name: "Estudar com o Oli" })).toHaveCount(0);
    await expect(karen.getByTestId("arquivo-aula").getByRole("button", { name: "Apagar" })).toHaveCount(0);
  });

  await test.step("resumo com o Gemini simulado: texto simples, salvo e editável", async () => {
    await page.getByRole("button", { name: "Resumir aula" }).click();
    const resumo = page.getByRole("region", { name: "Resumo da aula" });
    await expect(resumo.getByText("Resumo simulado da aula")).toBeVisible({ timeout: 30_000 });
    await expect(resumo.getByText("Arquivos inline: 1")).toBeVisible();
    await expect(resumo.getByText("<b>")).toHaveCount(0);
    await expect(page.getByTestId("resumo-status")).toContainText("Pronto");
    const { data } = await admin.from("igreja_carisma_lessons").select("summary, summary_status").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    expect(data?.summary_status).toBe("pronto");
    expect(data?.summary).not.toContain("<b>");
    // Cada tentativa fica no log imutável da família; com 20 no dia, a próxima é recusada antes da IA.
    const { count: logged } = await admin.from("igreja_summary_log").select("id", { count: "exact", head: true }).eq("household_id", E2E_IGREJA_HOUSEHOLD_ID);
    expect(logged).toBe(studyCalls + 1);
    const { error: fillErr } = await admin.from("igreja_summary_log").insert(Array.from({ length: 19 - studyCalls }, () => ({ household_id: E2E_IGREJA_HOUSEHOLD_ID })));
    expect(fillErr).toBeNull();
    await page.getByRole("button", { name: "Resumir aula" }).click();
    await expect(page.getByText("Limite de 20 resumos por dia atingido.")).toBeVisible();
    const { count: after } = await admin.from("igreja_summary_log").select("id", { count: "exact", head: true }).eq("household_id", E2E_IGREJA_HOUSEHOLD_ID);
    expect(after).toBe(21);
    await resumo.getByRole("button", { name: "Editar resumo" }).click();
    await resumo.getByLabel("Editar resumo").fill("Resumo revisado por mim.");
    await resumo.getByRole("button", { name: "Salvar resumo" }).click();
    await expect(resumo.getByText("Resumo revisado por mim.")).toBeVisible();
  });

  await test.step("Karen desconecta o Google; desfazer o compartilhamento tira a leitura da pasta mesmo assim e ela deixa de ver (404)", async () => {
    const { error: delErr } = await admin.from("google_accounts").delete().eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).eq("email", K_GOOGLE);
    expect(delErr).toBeNull();
    await page.reload();
    await page.getByRole("region", { name: "Compartilhamento" }).getByLabel(/Compartilhar com a família/).uncheck();
    await expect(page.getByRole("status").filter({ hasText: "Aula só sua de novo." })).toBeVisible();
    const { data: lesson } = await admin.from("igreja_carisma_lessons").select("drive_folder_id").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    const folder = (await driveFiles()).find((x) => x.id === lesson!.drive_folder_id)!;
    expect(folder.permissions.some((p) => p.emailAddress === K_GOOGLE)).toBe(false);
    expect(folder.permissions.every((p) => p.role === "owner")).toBe(true);
    expect((await karen.request.get(lessonUrl)).status()).toBe(404);
  });

  await test.step("aula de outra família: 404", async () => {
    const otherHh = randomUUID();
    const otherEmail = uniqueEmail("igreja-outra");
    await createFamilyWithId(otherHh, otherEmail, PASSWORD);
    const { data: u } = await admin.from("household_users").select("user_id").eq("household_id", otherHh).single();
    const { data: l, error } = await admin
      .from("igreja_carisma_lessons")
      .insert({ household_id: otherHh, owner_id: u!.user_id, title: "Aula de outra família", shared: true })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect((await page.request.get(`/ministerio/carisma/${l!.id}`)).status()).toBe(404);
    expect((await page.request.get(`/ministerio/carisma/nao-e-uuid`)).status()).toBe(404);
    await admin.from("households").delete().eq("id", otherHh);
  });

  await test.step("Consolidação: só a tela, com aviso de integração em breve", async () => {
    await page.goto("/ministerio/consolidacao");
    await expect(page.getByText("Integração com o app da Consolidação em breve").first()).toBeVisible();
    for (const s of ["Escala", "Reuniões", "Pessoas acompanhadas"]) await expect(page.getByRole("region", { name: s })).toBeVisible();
  });

  await test.step("apagar a aula manda arquivos e pasta para a lixeira do Drive", async () => {
    await page.goto(lessonUrl);
    const { data: lesson } = await admin.from("igreja_carisma_lessons").select("drive_folder_id").eq("household_id", E2E_IGREJA_HOUSEHOLD_ID).single();
    await page.getByRole("button", { name: "Apagar" }).first().click();
    await page.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(page).toHaveURL(/\/ministerio\/carisma$/);
    const files = await driveFiles();
    expect(files.find((x) => x.id === lesson!.drive_folder_id)?.trashed).toBe(true);
    const renamed = files.filter((x) => x.name === "Apostila da aula 1.pdf");
    expect(renamed.length).toBeGreaterThan(0);
    expect(renamed.every((x) => x.trashed)).toBe(true);
    const { count } = await admin.from("igreja_carisma_files").select("id", { count: "exact", head: true }).eq("household_id", E2E_IGREJA_HOUSEHOLD_ID);
    expect(count).toBe(0);
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/i.test(p))).toEqual([]);
  await karenCtx.close();
});
