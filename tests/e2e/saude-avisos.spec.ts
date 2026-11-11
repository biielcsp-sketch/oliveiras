import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./admin";
import { PASSWORD, signUp, uniqueEmail, watchConsole } from "./helpers";

/**
 * Avisos push da Saúde. Push real (FCM/Apple/Mozilla) não é testável no CI: o navegador de teste recebe uma
 * PushManager FALSA (endpoint https fictício) e a permissão simulada como concedida. O resto é real:
 * a tela, a server action, o banco com RLS e o logout. Entrega e exibição de notificação NÃO são cobertas aqui
 * (o envio é testado no Edge Function e o sw.js nos testes unitários).
 * Exige NEXT_PUBLIC_VAPID_PUBLIC_KEY definida no build (chave pública; qualquer valor base64url serve nos testes).
 */

const ENDPOINT = `https://push.example.test/e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MED = `Amoxicilina ${Date.now()}`;
const P256 = "B" + "a".repeat(86);
const AUTH = "b".repeat(22);

async function fakePush(page: Page) {
  await page.addInitScript(
    ([endpoint, p256dh, auth]) => {
      // O estado vive no sessionStorage: sobrevive à navegação, como a inscrição real do navegador.
      const KEY = "e2e-push-sub";
      const make = () => ({
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          sessionStorage.removeItem(KEY);
          return true;
        },
      });
      PushManager.prototype.getSubscription = async () => (sessionStorage.getItem(KEY) ? (make() as unknown as PushSubscription) : null);
      PushManager.prototype.subscribe = async () => {
        sessionStorage.setItem(KEY, "1");
        return make() as unknown as PushSubscription;
      };
      Object.defineProperty(Notification, "permission", { get: () => (sessionStorage.getItem("e2e-push-perm") ? "granted" : "default"), configurable: true });
      Notification.requestPermission = async () => {
        sessionStorage.setItem("e2e-push-perm", "1");
        return "granted";
      };
    },
    [ENDPOINT, P256, AUTH],
  );
}

async function createFamily(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await signUp(page, email);
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  return email;
}

async function signedClient(email: string, password: string) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

const rows = async () => (await adminClient().from("push_subscriptions").select("user_id, household_id, endpoint, user_agent").eq("endpoint", ENDPOINT)).data ?? [];

test("sem login: Medicamentos e Vacinas pedem entrada", async ({ page }) => {
  for (const path of ["/saude/medicamentos", "/saude/vacinas"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("Saúde avisos: horários do medicamento, inscrição do aparelho, privacidade entre pessoas e logout", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ serviceWorkers: "allow" });
  const a = await ctx.newPage();
  const problems = watchConsole(a);
  await fakePush(a);
  const email = await createFamily(a, "avisos-a");

  await test.step("medicamento com horários: ordena, tira repetido e mostra na lista", async () => {
    await a.goto("/saude/medicamentos");
    await a.getByRole("button", { name: "Novo medicamento" }).click();
    const d = a.getByRole("dialog", { name: "Novo medicamento" });
    await d.getByLabel("Medicamento", { exact: true }).fill(MED);
    for (const t of ["20:00", "08:00", "08:00"]) {
      await d.getByRole("button", { name: "Adicionar horário" }).click();
      await d.getByLabel(/^Horário do aviso/).last().fill(t);
    }
    await d.getByRole("button", { name: "Salvar medicamento" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Medicamento salvo." })).toBeVisible();
    await expect(a.getByTestId("medicamento")).toContainText("Avisos às 08:00, 20:00");
    const { data } = await adminClient().from("health_medications").select("reminder_times").eq("name", MED).single();
    expect(data?.reminder_times).toEqual(["08:00", "20:00"]);
  });

  await test.step("limite de 6 horários na tela", async () => {
    await a.getByRole("button", { name: "Editar" }).click();
    const d = a.getByRole("dialog", { name: "Editar medicamento" });
    for (let i = 0; i < 4; i++) await d.getByRole("button", { name: "Adicionar horário" }).click();
    await expect(d.getByLabel(/^Horário do aviso/)).toHaveCount(6);
    await expect(d.getByRole("button", { name: "Adicionar horário" })).toHaveCount(0);
    await d.getByRole("button", { name: "Fechar" }).click().catch(() => a.keyboard.press("Escape"));
  });

  await test.step("ativar avisos neste aparelho grava a assinatura da própria pessoa", async () => {
    await a.goto("/saude/medicamentos");
    const box = a.getByTestId("avisos-aparelho");
    await expect(box).toContainText("Avisos desativados neste aparelho");
    await box.getByRole("button", { name: "Ativar avisos" }).click();
    await expect(box).toContainText("Avisos ativados neste aparelho");
    const r = await rows();
    expect(r).toHaveLength(1);
    const { data: u } = await adminClient().auth.admin.listUsers();
    expect(r[0].user_id).toBe(u?.users.find((x) => x.email === email)?.id);
    expect(r[0].user_agent?.length ?? 0).toBeLessThanOrEqual(300);
    await a.goto("/saude/vacinas");
    await expect(a.getByTestId("avisos-aparelho")).toContainText("Avisos ativados neste aparelho");
  });

  await test.step("outra pessoa (mesma família ou outra família) não enxerga nem apaga a assinatura", async () => {
    const admin = adminClient();
    const householdId = (await rows())[0].household_id;
    const spouseMail = uniqueEmail("avisos-conj");
    const strangerMail = uniqueEmail("avisos-outra");
    const sp = await admin.auth.admin.createUser({ email: spouseMail, password: PASSWORD, email_confirm: true });
    const st = await admin.auth.admin.createUser({ email: strangerMail, password: PASSWORD, email_confirm: true });
    await admin.from("household_users").insert({ household_id: householdId, user_id: sp.data.user!.id, role: "member" });
    for (const mail of [spouseMail, strangerMail]) {
      const c = await signedClient(mail, PASSWORD);
      const read = await c.from("push_subscriptions").select("id");
      expect(read.data ?? []).toEqual([]);
      await c.from("push_subscriptions").delete().eq("endpoint", ENDPOINT);
      const forged = await c.from("push_subscriptions").insert({ household_id: householdId, user_id: sp.data.user!.id, endpoint: ENDPOINT + "/x", p256dh: P256, auth: AUTH });
      if (mail === strangerMail) expect(forged.error).not.toBeNull();
    }
    expect(await rows()).toHaveLength(1);
    await admin.from("push_subscriptions").delete().eq("endpoint", ENDPOINT + "/x");
    void st;
  });

  await test.step("desativar apaga a assinatura", async () => {
    await a.goto("/saude/medicamentos");
    const box = a.getByTestId("avisos-aparelho");
    await box.getByRole("button", { name: "Desativar avisos" }).click();
    await expect(box).toContainText("Avisos desativados neste aparelho");
    expect(await rows()).toHaveLength(0);
  });

  await test.step("sair da conta apaga a assinatura deste aparelho antes de encerrar a sessão", async () => {
    await a.goto("/saude/medicamentos");
    const box = a.getByTestId("avisos-aparelho");
    await box.getByRole("button", { name: "Ativar avisos" }).click();
    await expect(box).toContainText("Avisos ativados neste aparelho");
    expect(await rows()).toHaveLength(1);
    await a.goto("/familia");
    await a.getByRole("button", { name: "Sair" }).click();
    await expect(a).toHaveURL(/\/login$/);
    expect(await rows()).toHaveLength(0);
  });

  expect(problems.filter((p) => !/Failed to load resource/.test(p))).toEqual([]);
  await ctx.close();
});
