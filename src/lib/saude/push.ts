/**
 * Avisos por notificação push (Web Push). Funções puras: validação da assinatura no servidor,
 * conversão da chave pública VAPID e decisão do estado da tela. Nada aqui toca rede ou banco.
 * household_id e user_id NUNCA vêm do cliente: a action usa getAppContext().
 */

export const PUSH_LIMITS = { endpoint: 2048, userAgent: 300 } as const;

const B64URL = /^[A-Za-z0-9_-]+$/;
/** Chave P-256 não comprimida (65 bytes) e segredo de autenticação (16 bytes), em base64url sem preenchimento. */
const P256DH_LEN = 87;
const AUTH_LEN = 22;

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };
type Fail = { ok: false; erro: string };

/**
 * O endpoint é uma URL que o servidor de envio vai chamar: aceita só https, sem usuário/senha,
 * porta padrão, nome de domínio com ponto (nada de localhost nem IP), até 2048 caracteres.
 */
export function isValidPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > PUSH_LIMITS.endpoint) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname;
  if (!host.includes(".") || host.startsWith("[") || /^[0-9.]+$/.test(host) || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  return true;
}

export function validatePushSubscription(raw: unknown): { ok: true; value: PushSubscriptionInput } | Fail {
  const bad: Fail = { ok: false, erro: "Assinatura inválida." };
  if (typeof raw !== "object" || raw === null) return bad;
  const r = raw as Record<string, unknown>;
  if (!isValidPushEndpoint(r.endpoint)) return bad;
  const { p256dh, auth } = r;
  if (typeof p256dh !== "string" || !B64URL.test(p256dh) || p256dh.length !== P256DH_LEN) return bad;
  if (typeof auth !== "string" || !B64URL.test(auth) || auth.length !== AUTH_LEN) return bad;
  return { ok: true, value: { endpoint: r.endpoint, p256dh, auth } };
}

export const truncateUserAgent = (ua: string | null | undefined) => (ua ?? "").replace(/[\r\n]+/g, " ").slice(0, PUSH_LIMITS.userAgent) || null;

/** Chave pública VAPID (base64url) → bytes para pushManager.subscribe. Lança erro se não for base64url. */
export function urlBase64ToUint8Array(b64url: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(b64url)) throw new Error("chave inválida");
  const b64 = b64url.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type PushUi = "carregando" | "indisponivel" | "ios-instalar" | "sem-suporte" | "negada" | "inativo" | "ativo";

/** Qual estado mostrar, na ordem de prioridade. `subscribed` = este aparelho está inscrito E o servidor conhece a inscrição. */
export function pushUiState(i: {
  hasKey: boolean;
  ios: boolean;
  standalone: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}): Exclude<PushUi, "carregando"> {
  if (!i.hasKey) return "indisponivel";
  if (i.ios && !i.standalone) return "ios-instalar";
  if (!i.supported) return "sem-suporte";
  if (i.permission === "denied") return "negada";
  return i.subscribed && i.permission === "granted" ? "ativo" : "inativo";
}

/** Mesma regra do notificationclick em public/sw.js (lá é copiada à mão; um teste roda o SW de verdade). */
export const NOTIFICATION_PATHS = ["/saude/medicamentos", "/saude/vacinas"] as const;
export function notificationTarget(raw: unknown, origin: string): string {
  try {
    if (typeof raw !== "string") return "/inicio";
    const u = new URL(raw, origin);
    return u.origin === origin && (NOTIFICATION_PATHS as readonly string[]).includes(u.pathname) ? u.pathname : "/inicio";
  } catch {
    return "/inicio";
  }
}
