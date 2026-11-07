import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

describe("CSP", () => {
  const prod = buildCsp("abc123", false);

  it("usa nonce e strict-dynamic nos scripts", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });
  it("não permite unsafe-eval nem unsafe-inline em scripts em produção", () => {
    const script = prod.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).not.toContain("unsafe-eval");
    expect(script).not.toContain("unsafe-inline");
  });
  it("bloqueia iframe, plugins e base tag de terceiros", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
  });
  it("libera service worker do próprio domínio", () => {
    expect(prod).toContain("worker-src 'self'");
  });
  it("nonce é único por chamada", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe("headers fixos", () => {
  const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
  it.each([
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ])("inclui %s", (k) => expect(keys).toContain(k));
});
