import { mkdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_AGENDA_HOUSEHOLD_ID } from "../../playwright.config";
import { addSpouse, adminClient, createFamilyWithId } from "./admin";
import { PASSWORD, signUp, uniqueEmail, watchConsole } from "./helpers";
import { PanelView } from "../../src/components/oli/oli-panels";
import { buildEventos } from "../../src/lib/oli/panels";
import type { AgendaEvent } from "../../src/lib/agenda/view";

const MOCK = "http://127.0.0.1:4020";
const G_CAL = "gabriel.e2e@gmail.com";
const SCREENS = process.env.SCREENS ? "/home/claude/oliveiras/.screens" : null;

const mainText = async (page: Page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

async function syncNow(page: Page) {
  await page.goto("/agenda");
  await page.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Sincronizado|Atenção|Não foi/ })).toBeVisible();
}

async function eventCount(title: string) {
  const { count } = await adminClient()
    .from("cal_events")
    .select("id", { count: "exact", head: true })
    .eq("household_id", E2E_AGENDA_HOUSEHOLD_ID)
    .eq("title", title);
  return count ?? 0;
}

const mockEvents = async (cal: string) =>
  (await (await fetch(`${MOCK}/__events/${encodeURIComponent(cal)}`)).json()) as {
    id: string;
    summary: string;
    status: string;
    location?: string;
    start: { dateTime?: string; date?: string };
  }[];

async function shot(browser: Browser, from: BrowserContext, name: string, path: string, dark = false, before?: (p: Page) => Promise<void>) {
  if (!SCREENS) return;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await from.storageState() });
  if (dark) await ctx.addCookies([{ name: "tema", value: "dark", url: "http://localhost:3000" }]);
  else await ctx.addCookies([{ name: "tema", value: "light", url: "http://localhost:3000" }]);
  const p = await ctx.newPage();
  await p.goto(path);
  await p.waitForLoadState("networkidle");
  if (before) await before(p);
  await p.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await p.screenshot({ path: `${SCREENS}/${name}` });
  await ctx.close();
}

test("Agenda: conectar Google, sincronizar nas duas vias e ver a agenda do cônjuge", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await fetch(`${MOCK}/__reset`, { method: "POST" });
  const { today } = await (await fetch(`${MOCK}/__today`)).json();
  const gEmail = uniqueEmail("agenda-g");
  const kEmail = uniqueEmail("agenda-k");

  await test.step("família autorizada: Gabriel e Karen", async () => {
    await createFamilyWithId(E2E_AGENDA_HOUSEHOLD_ID, gEmail, PASSWORD);
    await addSpouse(E2E_AGENDA_HOUSEHOLD_ID, kEmail, PASSWORD, "Karen");
    await login(page, gEmail);
    await page.goto("/agenda");
    await expect(page.getByRole("heading", { name: "Contas Google" })).toBeVisible();
    const mine = page.getByTestId("conta-minha");
    await expect(mine).toContainText("Gabriel (você)");
    await expect(mine).toContainText("Não conectado");
    await expect(page.getByTestId("conta-outra")).toContainText("Karen");
    await expect(page.getByTestId("conta-outra").getByRole("link", { name: "Conectar Google" })).toHaveCount(0);
  });

  await test.step("state inválido no callback → erro, sem detalhes", async () => {
    await page.goto("/api/google/callback?code=qualquer&state=forjado");
    await expect(page).toHaveURL(/\/agenda\?google=erro$/);
    await expect(page.getByText("Não foi possível conectar ao Google. Tente de novo.")).toBeVisible();
    expect(await eventCount("Culto de domingo")).toBe(0);
  });

  await test.step("conectar: redirect → callback do mock → conta conectada e agendas listadas", async () => {
    await fetch(`${MOCK}/__user`, { method: "POST", body: JSON.stringify({ user: "gabriel" }) });
    await page.goto("/agenda");
    await page.getByRole("link", { name: "Conectar Google" }).click();
    await expect(page).toHaveURL(/\/agenda\?google=conectado$/);
    const mine = page.getByTestId("conta-minha");
    await expect(mine).toContainText(`Conectado · ${G_CAL}`);
    await expect(mine.getByRole("switch", { name: `Mostrar ${G_CAL}` })).toHaveAttribute("aria-checked", "true");
    await expect(mine.getByRole("switch", { name: "Mostrar Feriados no Brasil" })).toHaveAttribute("aria-checked", "false");
    // Token guardado cifrado (formato v1), nunca em claro.
    const { data } = await adminClient().from("google_accounts").select("token_ciphertext, email").eq("household_id", E2E_AGENDA_HOUSEHOLD_ID);
    expect(data).toHaveLength(1);
    expect(data![0].token_ciphertext).toMatch(/^v1\./);
    expect(data![0].token_ciphertext).not.toContain("rt-");
  });

  await test.step("sincronização inicial automática ao abrir (janela −60/+365 dias)", async () => {
    await expect.poll(() => mainText(page), { timeout: 20_000 }).toContain("Culto de domingo");
    const t = await mainText(page);
    expect(t).toContain("Folga");
    expect(t).toMatch(/Hoje/);
    expect(t).toMatch(/19:00 – 21:00 Culto de domingo Você · Igreja Lagoinha/);
    expect(await eventCount("Evento antigo")).toBe(0);
  });

  await test.step("sincronização incremental com syncToken, sem duplicar", async () => {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
    await fetch(`${MOCK}/__events/${encodeURIComponent(G_CAL)}`, {
      method: "POST",
      body: JSON.stringify({ summary: "Reunião GC", start: { dateTime: `${day}T20:00:00-03:00` }, end: { dateTime: `${day}T22:00:00-03:00` } }),
    });
    await syncNow(page);
    await expect.poll(() => mainText(page)).toContain("Reunião GC");
    await syncNow(page);
    expect(await eventCount("Culto de domingo")).toBe(1);
    expect(await eventCount("Reunião GC")).toBe(1);
    const calls = (await (await fetch(`${MOCK}/__calls`)).json()) as { method: string; path: string; query: Record<string, string> }[];
    const lists = calls.filter((c) => c.method === "GET" && c.path.endsWith(`${encodeURIComponent(G_CAL)}/events`));
    expect(lists.some((c) => c.query.syncToken && !c.query.timeMin && c.query.singleEvents === "true")).toBe(true);
    expect(lists.some((c) => c.query.timeMin && c.query.timeMax && !c.query.syncToken)).toBe(true);
  });

  await test.step("cancelado no Google some daqui; 410 refaz a carga completa", async () => {
    const reuniao = (await mockEvents(G_CAL)).find((e) => e.summary === "Reunião GC")!;
    await fetch(`${MOCK}/__cancel/${encodeURIComponent(G_CAL)}/${reuniao.id}`, { method: "POST" });
    await syncNow(page);
    expect(await mainText(page)).not.toContain("Reunião GC");
    expect(await eventCount("Reunião GC")).toBe(0);

    await fetch(`${MOCK}/__expire/${encodeURIComponent(G_CAL)}`, { method: "POST" });
    await syncNow(page);
    expect(await eventCount("Culto de domingo")).toBe(1);
    expect(await eventCount("Folga")).toBe(1);
  });


  await test.step("criar no app → aparece no Google", async () => {
    await page.goto("/agenda");
    await page.getByRole("button", { name: "Novo evento" }).click();
    const dialog = page.getByRole("dialog", { name: "Novo evento" });
    await dialog.getByLabel("Título").fill("Jantar E2E");
    await dialog.getByLabel("Início").fill(`${today}T20:00`);
    await dialog.getByLabel("Fim").fill(`${today}T19:00`);
    await dialog.getByRole("button", { name: "Criar evento" }).click();
    await expect(dialog.getByText("O fim não pode ser antes do início.")).toBeVisible();
    await dialog.getByLabel("Fim").fill(`${today}T21:30`);
    await dialog.getByLabel("Local").fill("Casa");
    await dialog.getByRole("button", { name: "Criar evento" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Evento criado." })).toBeVisible();
    await expect.poll(() => mainText(page)).toContain("Jantar E2E");
    const remote = (await mockEvents(G_CAL)).find((e) => e.summary === "Jantar E2E")!;
    expect(remote.start.dateTime).toBe(`${today}T20:00:00-03:00`);
    expect(remote.location).toBe("Casa");
    expect(await eventCount("Jantar E2E")).toBe(1);
  });

  await shot(browser, page.context(), "agenda-novo-evento-claro.png", "/agenda", false, async (p) => {
    await p.getByRole("button", { name: "Novo evento" }).click();
    await p.getByRole("dialog", { name: "Novo evento" }).getByLabel("Título").fill("Aniversário da vó");
  });

  await test.step("editar no app → atualiza no Google", async () => {
    await page.getByTestId("evento").filter({ hasText: "Jantar E2E" }).click();
    const details = page.getByRole("dialog", { name: "Jantar E2E" });
    await expect(details.getByRole("link", { name: "Abrir no Google" })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/calendar\/event\?eid=/);
    await details.getByRole("button", { name: "Editar" }).click();
    const form = page.getByRole("dialog", { name: "Editar evento" });
    await form.getByLabel("Título").fill("Jantar editado");
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Evento atualizado." })).toBeVisible();
    await expect.poll(async () => (await mockEvents(G_CAL)).some((e) => e.summary === "Jantar editado")).toBe(true);
    await expect.poll(() => mainText(page)).toContain("Jantar editado");
  });

  await test.step("conflito: mudou no Google → avisa e recarrega a versão nova", async () => {
    const ev = (await mockEvents(G_CAL)).find((e) => e.summary === "Jantar editado")!;
    await fetch(`${MOCK}/__touch/${encodeURIComponent(G_CAL)}/${ev.id}`, { method: "POST", body: JSON.stringify({ summary: "Mudado no Google" }) });
    await page.getByTestId("evento").filter({ hasText: "Jantar editado" }).click();
    await page.getByRole("dialog", { name: "Jantar editado" }).getByRole("button", { name: "Editar" }).click();
    const form = page.getByRole("dialog", { name: "Editar evento" });
    await form.getByLabel("Local").fill("Restaurante");
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(form.getByText("Este evento mudou no Google")).toBeVisible();
    await page.goto("/agenda");
    await expect.poll(() => mainText(page)).toContain("Mudado no Google");
    expect((await mockEvents(G_CAL)).find((e) => e.id === ev.id)!.location).toBe("Casa");
  });

  await test.step("apagar no app (com confirmação) → cancelado no Google", async () => {
    await page.getByTestId("evento").filter({ hasText: "Mudado no Google" }).click();
    const details = page.getByRole("dialog", { name: "Mudado no Google" });
    await details.getByRole("button", { name: "Apagar" }).click();
    await details.getByRole("group", { name: "Confirmar exclusão" }).getByRole("button", { name: "Apagar" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Evento apagado." })).toBeVisible();
    await expect.poll(() => mainText(page)).not.toContain("Mudado no Google");
    expect((await mockEvents(G_CAL)).find((e) => e.summary === "Mudado no Google")!.status).toBe("cancelled");
    expect(await eventCount("Mudado no Google")).toBe(0);
  });

  const karenCtx = await browser.newContext();
  const karen = await karenCtx.newPage();
  await test.step("cônjuge vê os eventos do outro, sem poder editar nem desconectar", async () => {
    await login(karen, kEmail);
    await karen.goto("/agenda");
    await expect.poll(() => mainText(karen)).toContain("Culto de domingo");
    expect(await mainText(karen)).toMatch(/Culto de domingo Gabriel · Igreja Lagoinha/);
    await karen.getByTestId("evento").filter({ hasText: "Culto de domingo" }).click();
    const d = karen.getByRole("dialog", { name: "Culto de domingo" });
    await expect(d.getByText("Só Gabriel pode editar este evento.")).toBeVisible();
    await expect(d.getByRole("button", { name: "Editar" })).toHaveCount(0);
    await d.getByRole("button", { name: "Fechar" }).click();
    const other = karen.getByTestId("conta-outra");
    await expect(other).toContainText(`Conectado · ${G_CAL}`);
    await expect(other.getByRole("button", { name: "Desconectar" })).toHaveCount(0);
    await expect(other.getByRole("switch")).toHaveCount(0);
  });

  await test.step("Karen conecta a conta dela; Gabriel vê os eventos dela", async () => {
    await fetch(`${MOCK}/__user`, { method: "POST", body: JSON.stringify({ user: "karen" }) });
    await karen.getByRole("link", { name: "Conectar Google" }).click();
    await expect(karen).toHaveURL(/google=conectado/);
    await expect.poll(() => mainText(karen), { timeout: 20_000 }).toContain("Consulta Karen");
    await syncNow(page);
    await expect.poll(() => mainText(page)).toMatch(/Consulta Karen Karen · Clínica/);
    await page.getByRole("group", { name: "Filtrar por pessoa" }).getByRole("button", { name: "Karen" }).click();
    expect(await mainText(page)).not.toContain("Culto de domingo");
    await page.getByRole("group", { name: "Filtrar por pessoa" }).getByRole("button", { name: "Todos" }).click();
  });
  await karenCtx.close();

  await shot(browser, page.context(), "agenda-claro.png", "/agenda");
  await shot(browser, page.context(), "agenda-escuro.png", "/agenda", true);
  await shot(browser, page.context(), "agenda-contas-claro.png", "/agenda", false, async (p) => {
    await p.getByRole("heading", { name: "Contas Google" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
  });

  await test.step("calendário do topo: pontinhos e lista do dia", async () => {
    await page.goto("/agenda");
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("ponto-evento").first()).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Eventos do dia" })).toContainText("Culto de domingo");
    await expect(dialog.getByRole("link", { name: "Abrir agenda" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await shot(browser, page.context(), "calendario-topo-eventos-claro.png", "/agenda", false, async (p) => {
    await p.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(p.getByRole("list", { name: "Eventos do dia" })).toBeVisible();
  });

  if (SCREENS) {
    // Painel do Oli com os eventos reais sincronizados do mock (o Oli real precisa do Gemini).
    const { data: rows } = await adminClient()
      .from("cal_events")
      .select("id, title, all_day, starts_at, ends_at, location, calendar_ref, cal_calendars(summary, color, google_calendar_id)")
      .eq("household_id", E2E_AGENDA_HOUSEHOLD_ID)
      .order("starts_at");
    const events: AgendaEvent[] = (rows ?? []).map((r) => {
      const cal = r.cal_calendars as unknown as { summary: string; color: string; google_calendar_id: string };
      return {
        id: r.id,
        title: r.title,
        allDay: r.all_day,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        location: r.location,
        description: null,
        htmlLink: null,
        calendarId: r.calendar_ref,
        calendarName: cal.summary,
        color: cal.color,
        memberId: "",
        owner: cal.google_calendar_id === G_CAL ? "Você" : "Karen",
        editable: false,
      };
    });
    const to = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    const html = renderToStaticMarkup(
      createElement("section", { className: "flex flex-col gap-4" }, [
        createElement(PanelView, { key: "a", panel: { id: "p1", kind: "eventos", data: buildEventos(events, today, to, null) }, onConfirm: () => {}, onCancel: () => {} }),
        createElement(PanelView, {
          key: "b",
          panel: {
            id: "p2",
            kind: "confirmar_evento",
            status: "pendente",
            data: { titulo: "Dentista", dia_inteiro: false, inicio: `${to}T15:00`, fim: `${to}T16:00`, local: "Centro", agenda: { id: "x", nome: G_CAL } },
          },
          onConfirm: () => {},
          onCancel: () => {},
        }),
      ]),
    );
    await shot(browser, page.context(), "oli-painel-eventos-claro.png", "/financas", false, async (p) => {
      await p.evaluate((h) => {
        const main = document.querySelector("main")!;
        main.innerHTML = h; // só no teste, para fotografar o painel com o CSS do app
      }, html);
    });
  }

  await test.step("acesso revogado no Google: marca 'Precisa reconectar' e mantém os eventos", async () => {
    await fetch(`${MOCK}/__revoke-all`, { method: "POST" });
    await syncNow(page);
    await expect(page.getByTestId("conta-minha")).toContainText("Precisa reconectar");
    expect(await eventCount("Culto de domingo")).toBe(1);
    await fetch(`${MOCK}/__user`, { method: "POST", body: JSON.stringify({ user: "gabriel" }) });
    await page.getByTestId("conta-minha").getByRole("link", { name: "Reconectar" }).click();
    await expect(page).toHaveURL(/google=conectado/);
    await expect(page.getByTestId("conta-minha")).toContainText(`Conectado · ${G_CAL}`);
    const { data } = await adminClient().from("google_accounts").select("id").eq("household_id", E2E_AGENDA_HOUSEHOLD_ID);
    expect(data).toHaveLength(2); // reconectar atualiza a mesma conta, não duplica
  });

  await test.step("desconectar (só o dono, com confirmação) apaga a conta e os eventos dela", async () => {
    await page.goto("/agenda");
    const mine = page.getByTestId("conta-minha");
    await mine.getByRole("button", { name: "Desconectar" }).click();
    await mine.getByRole("group", { name: "Confirmar desconexão" }).getByRole("button", { name: "Desconectar" }).click();
    await expect(page.getByTestId("conta-minha")).toContainText("Não conectado");
    expect(await eventCount("Culto de domingo")).toBe(0);
    expect(await eventCount("Consulta Karen")).toBe(1);
  });

  expect(problems.filter((p) => /Content Security Policy|Refused to/.test(p))).toEqual([]);
});

test("Agenda: família não autorizada recebe 403 no connect e a tela avisa", async ({ page }) => {
  await signUp(page, uniqueEmail("agenda-x"));
  await page.getByLabel("Seu nome").fill("Fulano");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  const res = await page.request.get("/api/google/connect", { maxRedirects: 0 });
  expect(res.status()).toBe(403);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(res.headers()["set-cookie"] ?? "").not.toContain("g_oauth");
  await page.goto("/agenda");
  await expect(page.getByText("A Agenda ainda não está liberada para esta família.")).toBeVisible();
});

test("Agenda: connect sem login vai para o login; callback sem login também", async ({ request }) => {
  const a = await request.get("/api/google/connect", { maxRedirects: 0 });
  expect(a.status()).toBe(307);
  expect(a.headers().location).toMatch(/\/login$/);
  const b = await request.get("/api/google/callback?code=x&state=y", { maxRedirects: 0 });
  expect(b.headers().location).toMatch(/\/login$/);
});
