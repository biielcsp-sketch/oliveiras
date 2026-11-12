/**
 * Política de segurança de conteúdo (CSP) com nonce por requisição.
 * Usada no proxy; os demais headers fixos ficam no next.config.ts.
 */
export function buildCsp(nonce: string, isDev: boolean, env: Record<string, string | undefined> = process.env) {
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Atributo style (ex.: cor do avatar) — sem execução de código
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Oli: o navegador abre o WebSocket do Gemini Live direto (token efêmero emitido pelo servidor).
    // Só o wss: o SDK não faz chamadas https a partir do navegador (o token é criado no servidor).
    // Carisma: o navegador envia o arquivo DIRETO ao Google Drive (PUT no session URI de upload resumível,
    // https://www.googleapis.com/upload/drive/v3/…), porque a função da Vercel não aceita corpo acima de 4,5 MB.
    `connect-src 'self' ${supabase} wss://generativelanguage.googleapis.com https://www.googleapis.com ${driveUploadTestOrigin(env)}`
      .replace(/\s+/g, " ")
      .trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Só nos testes E2E: origem do Drive simulado (GOOGLE_DRIVE_UPLOAD_BASE), aceita apenas em localhost e nunca
 * em produção na Vercel. Fora disso, vazio.
 */
export function driveUploadTestOrigin(env: Record<string, string | undefined>) {
  const raw = env.GOOGLE_DRIVE_UPLOAD_BASE?.trim();
  if (!raw || env.VERCEL_ENV === "production") return "";
  try {
    const u = new URL(raw);
    return ["localhost", "127.0.0.1"].includes(u.hostname) && /^https?:$/.test(u.protocol) ? u.origin : "";
  } catch {
    return "";
  }
}

export function createNonce() {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/** Headers fixos aplicados a todas as rotas (next.config.ts). */
export const STATIC_SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): o Oli escuta pelo microfone só neste domínio (iframes de terceiros continuam bloqueados).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
