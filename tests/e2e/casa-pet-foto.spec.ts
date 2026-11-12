import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

/** Casa > Pet: foto de perfil (reduzida para JPEG no navegador), troca, remoção, apagar pet e isolamento entre famílias. */

async function createFamily(page: Page, tag: string) {
  await signUp(page, uniqueEmail(tag));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

const status = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** PNG RGB sólido (decodificável pelo navegador); 1200 px de largura testa a redução. */
function png(w: number, h: number, rgb: [number, number, number]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const file = (name: string, buffer: Buffer, mimeType = "image/png") => ({ name, mimeType, buffer });

test("Pet sem login: foto bloqueada", async ({ page }) => {
  const res = await page.request.get("/casa/pet/arquivo/foto/22222222-2222-4222-8222-222222222222", { maxRedirects: 0 });
  expect([307, 401]).toContain(res.status());
});

test("Pet: foto de perfil (cadastrar, trocar, remover, apagar) e outra família sem acesso", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const problems = watchConsole(a);
  await createFamily(a, "pet-foto-a");
  const admin = adminClient();

  // Depois do cadastro, consulta pelo id: casa-pet.spec.ts também cria um pet "Moisés" em paralelo, e o mais recente por nome
  // (de qualquer família) poderia ser o dele, sem foto.
  const photoOf = async (name: string) => {
    const q = admin.from("casa_pets").select("id, household_id, photo_path, photo_mime, photo_size");
    const { data } = await (petId ? q.eq("id", petId) : q.eq("name", name).order("created_at", { ascending: false }).limit(1)).single();
    return data!;
  };
  const stored = async (path: string) => !(await admin.storage.from("casa").download(path)).error;

  let petId = "";
  let firstPath = "";
  await test.step("erro para arquivo ilegível; cadastra com PNG grande, que vira JPEG pequeno", async () => {
    await a.goto("/casa/pet");
    await a.getByRole("button", { name: "Cadastrar pet" }).click();
    const d = a.getByRole("dialog", { name: "Novo pet" });
    await d.getByLabel("Nome do pet").fill("Moisés");

    // Arquivo que o navegador não decodifica (ex.: HEIC): erro claro, nada é selecionado.
    await d.getByRole("group", { name: "Foto do pet" }).getByLabel("Imagem", { exact: true }).setInputFiles(file("foto.heic", Buffer.from("isto nao e imagem"), "image/heic"));
    await expect(d.getByRole("alert")).toContainText("Escolha uma foto JPG ou PNG");
    await expect(d.getByRole("button", { name: "Remover foto" })).toHaveCount(0);

    await d.getByRole("group", { name: "Foto do pet" }).getByLabel("Imagem", { exact: true }).setInputFiles(file("grande.png", png(1200, 900, [200, 80, 40])));
    await expect(d.getByTestId("pet-avatar")).toBeVisible(); // pré-visualização antes de salvar
    await d.getByRole("button", { name: "Cadastrar pet" }).click();
    await expect(status(a, "Moisés cadastrado.")).toBeVisible();

    const row = await photoOf("Moisés");
    petId = row.id as string;
    firstPath = row.photo_path as string;
    expect(firstPath).toMatch(new RegExp(`^${row.household_id}/pets/[0-9a-f-]{36}\\.jpg$`));
    expect(row.photo_mime).toBe("image/jpeg");
    expect(Number(row.photo_size)).toBeGreaterThan(0);
    expect(Number(row.photo_size)).toBeLessThan(4 * 1024 * 1024);
    expect(await stored(firstPath)).toBe(true);
  });

  await test.step("avatar no cartão com alt = nome; rota devolve JPEG sem cache", async () => {
    const avatar = a.getByTestId("pet").getByRole("img", { name: "Moisés" });
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute("width", "80");
    const src = await avatar.getAttribute("src");
    expect(src).toMatch(new RegExp(`^/casa/pet/arquivo/foto/${petId}\\?v=[0-9a-f-]{36}$`));
    const res = await a.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.body();
    expect([...body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(body.length).toBeLessThan(4 * 1024 * 1024);
    // O servidor não entrega o caminho do bucket ao navegador.
    expect(await a.content()).not.toContain(firstPath);
  });

  let secondPath = "";
  await test.step("trocar a foto: arquivo antigo some do storage", async () => {
    await a.getByTestId("pet").getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar Moisés" });
    await d.getByRole("group", { name: "Foto do pet" }).getByLabel("Imagem", { exact: true }).setInputFiles(file("nova.png", png(300, 600, [20, 90, 200])));
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(status(a, "Moisés atualizado.")).toBeVisible();
    secondPath = (await photoOf("Moisés")).photo_path as string;
    expect(secondPath).not.toBe(firstPath);
    expect(await stored(secondPath)).toBe(true);
    await expect.poll(() => stored(firstPath)).toBe(false);
  });

  await test.step("editar sem mexer na foto a mantém", async () => {
    await a.getByTestId("pet").getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar Moisés" });
    await d.getByLabel("Raça").fill("Vira-lata");
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(status(a, "Moisés atualizado.")).toBeVisible();
    expect((await photoOf("Moisés")).photo_path).toBe(secondPath);
  });

  await test.step("durante o processamento da foto o salvar fica desabilitado e a foto não se perde", async () => {
    await a.getByTestId("pet").getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar Moisés" });
    // Atrasa a conversão em canvas (toBlob) para dar tempo de observar o estado "preparando".
    await a.evaluate(() => {
      const orig = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        setTimeout(() => orig.apply(this, args), 1500);
      };
    });
    await d.getByRole("group", { name: "Foto do pet" }).getByLabel("Imagem", { exact: true }).setInputFiles(file("lenta.png", png(64, 64, [90, 90, 90])));
    await expect(d.getByText("Preparando a foto…")).toBeVisible();
    await expect(d.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    await expect(d.getByText("Preparando a foto…")).toHaveCount(0);
    await expect(d.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
    // Falha de leitura: erro aparece, salvar volta a funcionar e a foto atual NÃO é removida.
    await d.getByRole("group", { name: "Foto do pet" }).getByLabel("Imagem", { exact: true }).setInputFiles(file("ruim.heic", Buffer.from("nao e imagem"), "image/heic"));
    await expect(d.getByRole("alert")).toContainText("Escolha uma foto JPG ou PNG");
    await expect(d.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
    await d.getByRole("button", { name: "Fechar" }).click(); // sem salvar: a foto atual segue intacta
    expect(await photoOf("Moisés")).toMatchObject({ photo_path: secondPath });
  });

  await test.step("remover a foto: colunas nulas, arquivo apagado, volta a inicial", async () => {
    await a.getByTestId("pet").getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar Moisés" });
    await d.getByRole("button", { name: "Remover foto" }).click();
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(status(a, "Moisés atualizado.")).toBeVisible();
    // O aviso "Moisés atualizado." de um salvamento anterior continua na tela: ele não prova que ESTE salvamento terminou.
    // Espera o banco (e só então confere as colunas), em vez de ler logo depois do clique.
    await expect.poll(async () => (await photoOf("Moisés")).photo_path).toBeNull();
    const row = await photoOf("Moisés");
    expect([row.photo_path, row.photo_mime, row.photo_size]).toEqual([null, null, null]);
    // O servidor grava o banco e só depois apaga o arquivo: espera o arquivo sumir.
    await expect.poll(() => stored(secondPath)).toBe(false);
    await expect(a.getByTestId("pet").getByTestId("pet-avatar-vazio")).toHaveText("M");
    expect((await a.request.get(`/casa/pet/arquivo/foto/${petId}`)).status()).toBe(404);
  });

  let thirdPath = "";
  let urlA = "";
  await test.step("nova foto e, depois, apagar o pet remove o arquivo do storage", async () => {
    await a.getByTestId("pet").getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar Moisés" });
    await d.getByRole("group", { name: "Foto do pet" }).getByLabel("Imagem", { exact: true }).setInputFiles(file("outra.png", png(64, 64, [0, 160, 80])));
    await d.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(status(a, "Moisés atualizado.")).toBeVisible();
    // Mesmo motivo do passo de remover: o aviso "atualizado" anterior ainda está na tela, então espera a foto nova chegar ao banco.
    await expect.poll(async () => (await photoOf("Moisés")).photo_path).not.toBeNull();
    thirdPath = (await photoOf("Moisés")).photo_path as string;
    urlA = (await a.getByTestId("pet").getByRole("img", { name: "Moisés" }).getAttribute("src"))!;
    expect(await stored(thirdPath)).toBe(true);
  });

  await test.step("outra família: 404 na foto do pet alheio", async () => {
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await createFamily(b, "pet-foto-b");
    expect((await b.request.get(urlA)).status()).toBe(404);
    expect((await b.request.get(`/casa/pet/arquivo/foto/${petId}`)).status()).toBe(404);
    expect((await b.request.get("/casa/pet/arquivo/foto/nao-e-uuid")).status()).toBe(404);
    await ctxB.close();
  });

  await test.step("apagar o pet apaga a foto", async () => {
    await a.getByTestId("pet").getByRole("button", { name: "Apagar" }).click();
    await a.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(status(a, "Moisés foi apagado.")).toBeVisible();
    await expect.poll(() => stored(thirdPath)).toBe(false);
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/.test(p))).toEqual([]);
  await ctxA.close();
});
