import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { validateMedicationInput, validateReminderTimes } from "@/lib/saude/input";
import { describeActivationError, isValidPushEndpoint, notificationTarget, pushUiState, truncateUserAgent, urlBase64ToUint8Array, validatePushSubscription } from "@/lib/saude/push";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const P256 = "B" + "a".repeat(86);
const AUTH = "b".repeat(22);
const sub = { endpoint: "https://push.example.test/abc", p256dh: P256, auth: AUTH };

describe("horários dos avisos", () => {
  it("ordena, tira repetidos e vazios", () => {
    expect(validateReminderTimes(["20:00", "08:00", "", "08:00", " 12:30 "])).toEqual({ ok: true, value: ["08:00", "12:30", "20:00"] });
    expect(validateReminderTimes(undefined)).toEqual({ ok: true, value: [] });
    expect(validateReminderTimes("07:15")).toEqual({ ok: true, value: ["07:15"] });
  });
  it.each(["8:00", "24:00", "12:60", "08:00:00", "ab:cd", "08h00", "08:0", "<b>", "0800"])("recusa %s", (t) => {
    expect(validateReminderTimes([t]).ok).toBe(false);
  });
  it("recusa não-texto e mais de 6 horários distintos; 6 passam", () => {
    expect(validateReminderTimes([800]).ok).toBe(false);
    expect(validateReminderTimes(["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"]).ok).toBe(false);
    expect(validateReminderTimes(["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "06:00"]).ok).toBe(true);
  });
  it("o medicamento carrega os horários validados e recusa horário inválido", () => {
    const ok = validateMedicationInput({ member_id: MEMBER, name: "X", reminder_times: ["21:00", "09:00"] }, [MEMBER]);
    expect(ok.ok && ok.value.reminder_times).toEqual(["09:00", "21:00"]);
    expect(validateMedicationInput({ member_id: MEMBER, name: "X", reminder_times: ["25:00"] }, [MEMBER]).ok).toBe(false);
    const none = validateMedicationInput({ member_id: MEMBER, name: "X" }, [MEMBER]);
    expect(none.ok && none.value.reminder_times).toEqual([]);
  });
});

describe("assinatura push", () => {
  it("aceita assinatura válida", () => {
    expect(validatePushSubscription(sub)).toEqual({ ok: true, value: sub });
  });
  it("ignora campos extras (household_id/user_id do cliente nunca entram)", () => {
    const r = validatePushSubscription({ ...sub, household_id: "x", user_id: "y" });
    expect(r.ok && Object.keys(r.value).sort()).toEqual(["auth", "endpoint", "p256dh"]);
  });
  it.each([
    ["http", "http://push.example.test/a"],
    ["javascript", "javascript:alert(1)"],
    ["sem URL", "abc"],
    ["muito longa", "https://push.example.test/" + "a".repeat(2048)],
    ["localhost", "https://localhost/a"],
    ["IP", "https://10.0.0.1/a"],
    ["IPv6", "https://[::1]/a"],
    ["com senha", "https://u:p@push.example.test/a"],
    ["porta estranha", "https://push.example.test:8443/a"],
  ])("recusa endpoint %s", (_n, endpoint) => {
    expect(isValidPushEndpoint(endpoint)).toBe(false);
    expect(validatePushSubscription({ ...sub, endpoint }).ok).toBe(false);
  });
  it("recusa chaves fora de base64url ou com tamanho errado", () => {
    expect(validatePushSubscription({ ...sub, p256dh: "B" + "+".repeat(86) }).ok).toBe(false);
    expect(validatePushSubscription({ ...sub, p256dh: "B" + "a".repeat(10) }).ok).toBe(false);
    expect(validatePushSubscription({ ...sub, auth: "b".repeat(21) }).ok).toBe(false);
    expect(validatePushSubscription({ ...sub, auth: "b".repeat(21) + "=" }).ok).toBe(false);
    expect(validatePushSubscription({ ...sub, auth: 5 }).ok).toBe(false);
    expect(validatePushSubscription(null).ok).toBe(false);
    expect(validatePushSubscription("x").ok).toBe(false);
  });
  it("user_agent é truncado em 300 e sem quebra de linha", () => {
    expect(truncateUserAgent("a".repeat(500))).toHaveLength(300);
    expect(truncateUserAgent("a\nb")).toBe("a b");
    expect(truncateUserAgent("")).toBeNull();
    expect(truncateUserAgent(null)).toBeNull();
  });
});

describe("chave VAPID", () => {
  it("converte base64url (com - e _) em bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("AQI="))).toEqual([1, 2]);
  });
  it("chave pública de 65 bytes (87 caracteres) vira 65 bytes", () => {
    expect(urlBase64ToUint8Array("B" + "A".repeat(86))).toHaveLength(65);
  });
  it("recusa texto que não é base64url", () => {
    expect(() => urlBase64ToUint8Array("a b")).toThrow();
    expect(() => urlBase64ToUint8Array("a+b/")).toThrow();
  });
});

describe("estado da tela de avisos", () => {
  const base = { hasKey: true, ios: false, standalone: false, supported: true, permission: "default" as const, subscribed: false };
  it("segue a ordem de prioridade", () => {
    expect(pushUiState({ ...base, hasKey: false, ios: true })).toBe("indisponivel");
    expect(pushUiState({ ...base, ios: true, supported: false })).toBe("ios-instalar");
    expect(pushUiState({ ...base, ios: true, standalone: true })).toBe("inativo");
    expect(pushUiState({ ...base, supported: false })).toBe("sem-suporte");
    expect(pushUiState({ ...base, permission: "denied" })).toBe("negada");
    expect(pushUiState(base)).toBe("inativo");
    expect(pushUiState({ ...base, permission: "granted", subscribed: true })).toBe("ativo");
    expect(pushUiState({ ...base, permission: "default", subscribed: true })).toBe("inativo");
  });
});

describe("destino do clique na notificação", () => {
  const O = "https://app.test";
  it("só aceita as páginas da lista, na mesma origem", () => {
    expect(notificationTarget("/casa/pet", O)).toBe("/casa/pet");
    expect(notificationTarget("/saude/medicamentos", O)).toBe("/saude/medicamentos");
    expect(notificationTarget("/saude/vacinas", O)).toBe("/saude/vacinas");
    expect(notificationTarget("https://app.test/saude/vacinas", O)).toBe("/saude/vacinas");
    expect(notificationTarget("/saude/vacinas?x=1#y", O)).toBe("/saude/vacinas");
  });
  it.each(["https://evil.test/saude/vacinas", "//evil.test/saude/vacinas", "/saude", "/saude/vacinas/x", "/casa/pet/arquivo/saude/x", "/casa", "https://evil.test/casa/pet", "/familia", "javascript:alert(1)", "", null, 5, undefined, {}])("%s vai para /inicio", (u) => {
    expect(notificationTarget(u, O)).toBe("/inicio");
  });
});

/** Roda o public/sw.js de verdade num contexto isolado, com um `self` falso, e devolve os handlers. */
function loadSw() {
  const src = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const state = { clients: [] as { url: string; focus: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }[] };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn),
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
    clients: {
      matchAll: async () => state.clients,
      openWindow: async (u: string) => void opened.push(u),
      claim: async () => {},
    },
    skipWaiting: () => {},
  };
  vm.runInNewContext(src, { self, caches: {}, URL, Response, fetch: async () => new Response() });
  return { handlers, shown, opened, state };
}

const pushEvent = (json: () => unknown, hasData = true) => {
  const waits: Promise<unknown>[] = [];
  return { data: hasData ? { json } : null, waitUntil: (p: Promise<unknown>) => waits.push(p), waits };
};

describe("service worker: push e notificationclick (sw.js executado)", () => {
  it("mostra título, texto, tag, ícone e url do payload", async () => {
    const { handlers, shown } = loadSw();
    const e = pushEvent(() => ({ title: "Hora do remédio", body: "Amoxicilina", tag: "med:1", url: "/saude/medicamentos" }));
    handlers.push(e);
    await Promise.all(e.waits);
    expect(shown).toEqual([{ title: "Hora do remédio", options: { body: "Amoxicilina", tag: "med:1", icon: "/icons/icon-192.png", data: { url: "/saude/medicamentos" } } }]);
  });
  it("payload ausente, inválido ou de tipo errado vira aviso genérico", async () => {
    for (const e of [
      pushEvent(() => ({}), false),
      pushEvent(() => {
        throw new SyntaxError("json");
      }),
      pushEvent(() => "texto"),
      pushEvent(() => null),
      pushEvent(() => ({ title: { x: 1 }, body: 5, url: 7 })),
    ]) {
      const { handlers, shown } = loadSw();
      handlers.push(e);
      await Promise.all(e.waits);
      expect(shown).toHaveLength(1);
      expect(shown[0].title).toBe("Oliveira's: você tem um aviso");
      expect(shown[0].options.data).toEqual({ url: "/inicio" });
    }
  });
  it("limita o tamanho do título e do texto e não aceita url fora da lista", async () => {
    const { handlers, shown } = loadSw();
    const e = pushEvent(() => ({ title: "t".repeat(500), body: "b".repeat(5000), url: "https://evil.test/saude/vacinas" }));
    handlers.push(e);
    await Promise.all(e.waits);
    expect(shown[0].title).toHaveLength(80);
    expect((shown[0].options.body as string).length).toBe(200);
    expect(shown[0].options.data).toEqual({ url: "/inicio" });
  });
  const click = (url: unknown) => {
    const waits: Promise<unknown>[] = [];
    let closed = false;
    return { notification: { data: { url }, close: () => (closed = true) }, waitUntil: (p: Promise<unknown>) => waits.push(p), waits, closed: () => closed };
  };
  it("clique fecha a notificação e abre só destino da lista (senão /inicio)", async () => {
    for (const [raw, expected] of [
      ["/saude/vacinas", "https://app.test/saude/vacinas"],
      ["/saude/medicamentos", "https://app.test/saude/medicamentos"],
      ["/casa/pet", "https://app.test/casa/pet"],
      ["https://evil.test/x", "https://app.test/inicio"],
      ["/familia", "https://app.test/inicio"],
      [undefined, "https://app.test/inicio"],
    ] as const) {
      const { handlers, opened } = loadSw();
      const e = click(raw);
      handlers.notificationclick(e);
      await Promise.all(e.waits);
      expect(e.closed()).toBe(true);
      expect(opened).toEqual([expected]);
    }
  });
  it("com janela do app aberta, foca e navega nela em vez de abrir outra", async () => {
    const { handlers, opened, state } = loadSw();
    const navigated: string[] = [];
    const win = { url: "https://app.test/inicio", focus: async () => win, navigate: async (u: string) => void navigated.push(u) };
    state.clients = [{ url: "https://outro.test/", focus: async () => ({}) }, win];
    const e = click("/saude/vacinas");
    handlers.notificationclick(e);
    await Promise.all(e.waits);
    expect(navigated).toEqual(["https://app.test/saude/vacinas"]);
    expect(opened).toEqual([]);
  });
});

describe("service worker: strings (nada de cache novo; carteirinhas intactas)", () => {
  const sw = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");
  it("registra push e notificationclick e usa o ícone do app", () => {
    expect(sw).toContain('self.addEventListener("push"');
    expect(sw).toContain('self.addEventListener("notificationclick"');
    expect(sw).toContain('icon: "/icons/icon-192.png"');
    expect(sw).toContain('const NOTIFICATION_PATHS = ["/saude/medicamentos", "/saude/vacinas", "/casa/pet"]');
  });
  it("o trecho de push não mexe em cache e a regra do activate segue igual", () => {
    const push = sw.slice(sw.indexOf("Avisos por notificação push"));
    expect(push).not.toMatch(/caches|\.put\(|addAll|cache\.add/);
    expect(sw).toContain('const CACHE = "oliveiras-v2"');
    expect(sw).toMatch(/k !== CACHE && k !== CARDS_CACHE/);
  });
});

describe("mensagem de erro da ativação", () => {
  it("mostra a etapa e o código do erro do navegador", () => {
    const e = new DOMException("Registration failed - push service error", "AbortError");
    const m = describeActivationError("inscricao", e);
    expect(m).toContain("inscrição no serviço de push");
    expect(m).toContain("AbortError");
    expect(m).toContain("Registration failed - push service error");
  });
  it("remove URLs e caracteres estranhos da mensagem e limita o tamanho", () => {
    const e = new Error("falhou em https://fcm.googleapis.com/fcm/send/abc123 <script>" + "x".repeat(200));
    const m = describeActivationError("servidor", e);
    expect(m).not.toContain("fcm.googleapis.com");
    expect(m).not.toContain("<");
    expect(m.length).toBeLessThan(220);
  });
  it("erro sem nome válido ou que não é Error vira código genérico", () => {
    expect(describeActivationError("permissao", "texto")).toContain("código: Erro)");
    const e = new Error("x");
    e.name = "Nome com espaço";
    expect(describeActivationError("service-worker", e)).toContain("código: Erro");
  });
});
