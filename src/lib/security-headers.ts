/**
 * Política de segurança de conteúdo (CSP) com nonce por requisição.
 * Usada no proxy; os demais headers fixos ficam no next.config.ts.
 */
export function buildCsp(nonce: string, isDev: boolean) {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
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
    `connect-src 'self' ${supabase} wss://generativelanguage.googleapis.com`.replace(/\s+/g, " "),
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
