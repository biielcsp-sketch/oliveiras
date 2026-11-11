import { legacyContasPath } from "@/lib/financas/routes";

/** "Contas a pagar" virou "Contas fixas": redirecionamento permanente (308) para o equivalente novo. */
export async function GET(request: Request, { params }: { params: Promise<{ rest?: string[] }> }) {
  const { rest } = await params;
  const url = new URL(request.url);
  return new Response(null, {
    status: 308,
    headers: { Location: legacyContasPath(rest, url.search), "Cache-Control": "no-store" },
  });
}
