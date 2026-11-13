import { expect, test, type Page } from "@playwright/test";
import { addDays, brDate, toSpDate } from "../../src/lib/agenda/dates";
import { adminClient } from "./admin";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

/** Casa: aba Pet (Moisés): vacinas com anexo, veterinário, cuidados recorrentes, peso, ração e isolamento por família. */

async function createFamily(page: Page, tag: string) {
  await signUp(page, uniqueEmail(tag));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

const status = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

function pdf(tag: string) {
  return { name: "carteirinha.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`) };
}

test("Pet sem login: página e arquivo bloqueados", async ({ page }) => {
  await page.goto("/casa/pet");
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.get("/casa/pet/arquivo/saude/22222222-2222-4222-8222-222222222222", { maxRedirects: 0 });
  expect([307, 401]).toContain(res.status());
});

test("Pet: Moisés com vacina, veterinário, cuidados, peso e ração (isolado de outra família)", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const problems = watchConsole(a);
  await createFamily(a, "pet-a");
  const today = toSpDate(new Date());
  const admin = adminClient();
  const suffix = Math.random().toString(36).slice(2, 7);

  let petA = "";
  await test.step("aba Pet no menu; cadastrar o Moisés", async () => {
    await a.goto("/casa");
    const nav = a.getByRole("navigation", { name: "Seções de Casa" });
    await expect(a.getByRole("heading", { level: 1 })).toHaveText("Casa");
    await expect(nav.getByText("Pet", { exact: true })).toHaveCount(1);
    await expect(a.getByTestId("resumo-pet")).toContainText("Nenhum pet cadastrado.");

    await a.goto("/casa/pet");
    await expect(a.getByText("Nenhum pet cadastrado.")).toBeVisible();
    await a.getByRole("button", { name: "Cadastrar pet" }).click();
    const d = a.getByRole("dialog", { name: "Novo pet" });
    await d.getByLabel("Nome do pet").fill("Moisés");
    await d.getByLabel("Sexo").selectOption("macho");
    await d.getByLabel("Raça").fill("Vira-lata");
    await d.getByRole("button", { name: "Cadastrar pet" }).click();
    await expect(status(a, "Moisés cadastrado.")).toBeVisible();
    await expect(a.getByTestId("pet")).toContainText("Cachorro · Vira-lata · Macho");
    // Um pet só: sem seletor.
    await expect(a.getByRole("navigation", { name: "Escolher pet" })).toHaveCount(0);
    const { data } = await admin.from("casa_pets").select("id").eq("name", "Moisés").order("created_at", { ascending: false }).limit(1).single();
    petA = data!.id as string;
  });

  let healthId = "";
  let householdA = "";
  const due = addDays(today, 3);
  await test.step("vacina com comprovante: arquivo falso recusado, próxima dose em destaque e arquivo autenticado", async () => {
    const section = a.getByRole("region", { name: "Vacinas e remédios" });
    await section.getByRole("button", { name: "Novo", exact: true }).click();
    const d = a.getByRole("dialog", { name: "Nova vacina ou remédio" });
    await d.getByLabel("Nome", { exact: true }).fill("V10");
    await d.getByLabel("Dose", { exact: true }).fill("Reforço");
    await d.getByLabel("Aplicada em").fill(addDays(today, -362));
    await d.getByLabel("Próxima dose").fill(due);
    await d.getByRole("group", { name: /Anexo opcional/ }).getByLabel("PDF", { exact: true }).setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>oi</html>") });
    await d.getByRole("button", { name: "Salvar" }).click();
    await expect(d.getByText("Envie um arquivo PDF ou JPG.")).toBeVisible();
    await d.getByRole("group", { name: /Anexo opcional/ }).getByLabel("PDF", { exact: true }).setInputFiles(pdf("pet"));
    await d.getByRole("button", { name: "Salvar" }).click();
    await expect(status(a, "V10 salvo.")).toBeVisible();
    await expect(d).toHaveCount(0);

    await expect(a.getByRole("region", { name: "Próximas doses em destaque" })).toContainText("Vacina V10 - Reforço: em 3 dias");
    const row = a.getByTestId("pet-saude").filter({ hasText: "V10" });
    await expect(row).toContainText("Em breve");
    await expect(row.getByTestId("proxima-dose")).toContainText(`Próxima: ${brDate(due)} (em 3 dias)`);
    const link = row.getByRole("link", { name: "Abrir PDF" });
    const href = await link.getAttribute("href");
    healthId = href!.match(/^\/casa\/pet\/arquivo\/saude\/([0-9a-f-]{36})$/)![1];
    const res = await a.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["cache-control"]).toContain("no-store");

    const { data } = await admin.from("casa_pet_health").select("household_id, file_path").eq("id", healthId).single();
    householdA = data!.household_id as string;
    expect(data!.file_path).toMatch(new RegExp(`^${householdA}/pets/[0-9a-f-]{36}\\.pdf$`));

    // Próxima dose antes da aplicação: recusada.
    await row.getByRole("button", { name: "Editar" }).click();
    const e = a.getByRole("dialog", { name: "Editar vacina ou remédio" });
    await e.getByLabel("Próxima dose").fill(addDays(today, -400));
    await e.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(e.getByText("A próxima dose não pode ser antes da aplicação.")).toBeVisible();
    await e.getByRole("button", { name: "Fechar" }).click();
  });

  await test.step("veterinário: consulta com clínica, motivo e custo", async () => {
    const section = a.getByRole("region", { name: "Veterinário" });
    await section.getByRole("button", { name: "Novo registro" }).click();
    const d = a.getByRole("dialog", { name: "Novo registro do veterinário" });
    await d.getByLabel("Clínica").fill("Clínica Patas");
    await d.getByLabel("Veterinário").fill("Dra. Ana");
    await d.getByLabel("Motivo").fill("Check-up anual");
    await d.getByLabel("Custo (opcional)").fill("180,00");
    await d.getByRole("button", { name: "Salvar registro" }).click();
    await expect(status(a, "Registro do veterinário salvo.")).toBeVisible();
    const card = a.getByTestId("pet-vet");
    await expect(card).toContainText(`Consulta · ${brDate(today)}`);
    await expect(card).toContainText("Check-up anual");
    await expect(card).toContainText("Clínica Patas · Dra. Ana · R$");
    await expect(card).toContainText("180,00");
  });

  await test.step("cuidado recorrente com prestador: vencido, 'Feito hoje' recalcula a próxima data", async () => {
    await a.goto("/casa/prestadores");
    await a.getByRole("button", { name: "Novo prestador" }).click();
    const p = a.getByRole("dialog", { name: "Novo prestador" });
    await p.getByLabel("Nome").fill(`Pet Shop ${suffix}`);
    await p.getByLabel("Serviço").fill("Banho e tosa");
    await p.getByLabel("Telefone").fill("(11) 91234-5678");
    await p.getByRole("button", { name: "Salvar prestador" }).click();
    await expect(status(a, "Prestador salvo.")).toBeVisible();

    await a.goto("/casa/pet");
    await a.getByRole("region", { name: "Cuidados" }).getByRole("button", { name: "Novo cuidado" }).click();
    const d = a.getByRole("dialog", { name: "Novo cuidado" });
    await d.getByLabel("Cuidado", { exact: true }).fill("Banho");
    await d.getByLabel("A cada").fill("15");
    await d.getByLabel("Última vez feita").fill(addDays(today, -20));
    await d.getByLabel("Prestador cadastrado").selectOption({ label: `Pet Shop ${suffix} (Banho e tosa)` });
    await d.getByRole("button", { name: "Salvar cuidado" }).click();
    await expect(status(a, "Cuidado salvo.")).toBeVisible();
    const card = a.getByTestId("pet-cuidado").filter({ hasText: "Banho" });
    await expect(card).toContainText("Vencido");
    await expect(card.getByTestId("proxima")).toContainText(`Próximo: ${brDate(addDays(today, -5))} (há 5 dias)`);
    await expect(card.getByRole("link", { name: /^WhatsApp de/ })).toHaveAttribute("href", "https://wa.me/5511912345678");

    await card.getByRole("button", { name: "Feito hoje" }).click();
    await expect(status(a, "Banho: registrado hoje.")).toBeVisible();
    await expect(card.getByTestId("proxima")).toContainText(`Próximo: ${brDate(addDays(today, 15))}`);
    await expect(card).not.toContainText("Vencido");
    await card.getByText("Histórico").click();
    await expect(card.getByRole("listitem")).toHaveText([brDate(today)]);
    const { count } = await admin.from("casa_pet_care_log").select("id", { count: "exact", head: true }).eq("household_id", householdA);
    expect(count).toBe(1);
  });

  await test.step("peso: registrar de novo no mesmo dia atualiza (sem duplicar) e mostra a variação", async () => {
    const form = a.getByRole("form", { name: "Registrar peso" });
    await form.getByLabel("Peso (kg)").fill("12");
    await form.getByLabel("Data da pesagem").fill(addDays(today, -30));
    await form.getByRole("button", { name: "Registrar peso" }).click();
    const rows = a.getByTestId("pet-peso");
    await expect(rows).toHaveCount(1);
    await expect(form.getByLabel("Peso (kg)")).toHaveValue("");

    await form.getByLabel("Peso (kg)").fill("12,5");
    await form.getByRole("button", { name: "Registrar peso" }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(`12,5 kg · ${brDate(today)} · +0,5 kg`);
    await expect(form.getByLabel("Peso (kg)")).toHaveValue("");

    await form.getByLabel("Peso (kg)").fill("13");
    await form.getByRole("button", { name: "Registrar peso" }).click();
    await expect(status(a, "Peso do dia atualizado.")).toBeVisible();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(`13 kg · ${brDate(today)} · +1 kg`);
    const { count } = await admin.from("casa_pet_weights").select("id", { count: "exact", head: true }).eq("pet_id", petA).eq("measured_on", today);
    expect(count).toBe(1);
  });

  await test.step("ração acabando em destaque; mandar para a lista de compras sem duplicar", async () => {
    await a.getByRole("region", { name: "Ração" }).getByRole("button", { name: "Cadastrar ração" }).click();
    const d = a.getByRole("dialog", { name: "Nova ração" });
    await d.getByLabel("Ração", { exact: true }).fill("Premier");
    await d.getByLabel("Saco (kg)").fill("3");
    await d.getByLabel("Gramas por dia").fill("200");
    await d.getByLabel("Começou em").fill(addDays(today, -12));
    await d.getByRole("button", { name: "Salvar ração" }).click();
    await expect(status(a, "Ração salva.")).toBeVisible();
    const card = a.getByTestId("pet-racao");
    await expect(card).toContainText("Acabando");
    await expect(card.getByTestId("previsao")).toContainText(`Acaba por volta de ${brDate(addDays(today, 3))} (em 3 dias).`);

    await card.getByRole("button", { name: "Mandar ração para a lista de compras" }).click();
    await expect(status(a, "Ração Premier adicionada à lista de compras.")).toBeVisible();
    await card.getByRole("button", { name: "Mandar ração para a lista de compras" }).click();
    await expect(status(a, "Ração Premier já está na lista de compras.")).toBeVisible();
    await a.goto("/casa/compras");
    await expect(a.getByRole("checkbox", { name: "Ração Premier" })).toHaveCount(1);
  });

  await test.step("Resumo da Casa: card do Pet", async () => {
    await a.goto("/casa");
    const tile = a.getByTestId("resumo-pet");
    await expect(tile).toContainText("Próxima dose: Vacina V10 - Reforço (em 3 dias)");
    await expect(tile).toContainText("0 cuidados vencidos");
    await expect(tile).toContainText("Ração acabando");
  });

  await test.step("dose nova da mesma vacina: a antiga vira histórico e deixa de aparecer como atrasada", async () => {
    await a.goto("/casa/pet");
    const section = a.getByRole("region", { name: "Vacinas e remédios" });
    const add = async (name: string, applied: string, next: string) => {
      await section.getByRole("button", { name: "Novo", exact: true }).click();
      const d = a.getByRole("dialog", { name: "Nova vacina ou remédio" });
      await d.getByLabel("Nome", { exact: true }).fill(name);
      await d.getByLabel("Aplicada em").fill(applied);
      await d.getByLabel("Próxima dose").fill(next);
      await d.getByRole("button", { name: "Salvar" }).click();
      await expect(d).toHaveCount(0);
    };
    await add("Antirrábica", addDays(today, -400), addDays(today, -35));
    const rows = a.getByTestId("pet-saude").filter({ hasText: /antirr/i });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Atrasada");
    await expect(a.getByRole("region", { name: "Próximas doses em destaque" })).toContainText("Vacina Antirrábica: atrasada há 35 dias");

    await add("antirrabica", today, addDays(today, 365));
    await expect(rows).toHaveCount(2);
    const old = rows.filter({ hasText: "Antirrábica" });
    await expect(old.getByTestId("dose-anterior")).toBeVisible();
    await expect(old).not.toContainText("Atrasada");
    await expect(a.getByRole("region", { name: "Próximas doses em destaque" })).not.toContainText("Antirrábica");
    await expect(a.getByText("Atrasada", { exact: true })).toHaveCount(0);
  });

  await test.step("outra família: 404 no arquivo, nada visível e pet alheio recusado", async () => {
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await createFamily(b, "pet-b");
    expect((await b.request.get(`/casa/pet/arquivo/saude/${healthId}`)).status()).toBe(404);
    expect((await b.request.get(`/casa/pet/arquivo/documentos/${healthId}`)).status()).toBe(404);
    expect((await b.request.get("/casa/pet/arquivo/saude/nao-e-uuid")).status()).toBe(404);
    await b.goto(`/casa/pet?pet=${petA}`);
    await expect(b.getByText("Nenhum pet cadastrado.")).toBeVisible();
    await expect(b.getByText("Moisés")).toHaveCount(0);

    await b.getByRole("button", { name: "Cadastrar pet" }).click();
    const d = b.getByRole("dialog", { name: "Novo pet" });
    await d.getByLabel("Nome do pet").fill("Rex");
    await d.getByRole("button", { name: "Cadastrar pet" }).click();
    await expect(status(b, "Rex cadastrado.")).toBeVisible();

    // Formulário adulterado com o id do pet da família A: o servidor recusa e nada é gravado em A.
    await b.getByRole("region", { name: "Vacinas e remédios" }).getByRole("button", { name: "Novo", exact: true }).click();
    const h = b.getByRole("dialog", { name: "Nova vacina ou remédio" });
    await h.getByLabel("Nome", { exact: true }).fill("Invasora");
    await h.locator('input[name="pet_id"]').evaluate((el, id) => ((el as HTMLInputElement).value = id), petA);
    await h.getByRole("button", { name: "Salvar" }).click();
    await expect(h.getByText("Pet não encontrado.")).toBeVisible();
    const { count } = await admin.from("casa_pet_health").select("id", { count: "exact", head: true }).eq("pet_id", petA);
    expect(count).toBe(3);
    await ctxB.close();
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/.test(p))).toEqual([]);
  await ctxA.close();
});
