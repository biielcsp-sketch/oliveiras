// Chama a ferramenta do Oli (server action runOliTool) como a tela faz, com a sessão do navegador.
// Não há Gemini Live simulado: o modelo é substituído pelo teste, que pede a ferramenta direto.
// O id da action vem do manifesto do build (o mesmo que a tela usa), nunca de um endpoint de teste no app.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

let actionId: string | null = null;

function runOliToolId() {
  if (actionId) return actionId;
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
    node: Record<string, { filename?: string; exportedName?: string }>;
  };
  const found = Object.entries(manifest.node).find(
    ([, v]) => v.filename?.endsWith("src/app/(app)/inicio/oli-actions.ts") && v.exportedName === "runOliTool",
  );
  if (!found) throw new Error("runOliTool não está no manifesto do build (rode npm run build).");
  actionId = found[0];
  return actionId;
}

export type ToolResult = { ok: true; tool: string; data: Record<string, unknown> & { grupos?: { titulo: string; total: number; itens: { titulo: string; pessoa: string | null; arquivo: string | null }[] }[]; aviso?: string | null } } | { ok: false; erro: string };

/** POST da server action na página /inicio (mesma origem e cookies da página). */
export async function callOliTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const res = await page.request.post("/inicio", {
    headers: { "Next-Action": runOliToolId(), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify([name, args]),
    maxRedirects: 0,
  });
  if (res.status() !== 200) throw new Error(`action respondeu ${res.status()}`);
  const text = await res.text();
  // Resposta RSC: linhas "<id>:<json>"; o resultado da action é a linha 1 (a 0 aponta para ela).
  for (const line of text.split("\n")) {
    const m = /^1:(.*)$/.exec(line);
    if (m) return JSON.parse(m[1]) as ToolResult;
  }
  throw new Error(`resposta inesperada da action: ${text.slice(0, 200)}`);
}

/** Títulos de todos os itens de uma consulta (para conferir o que entrou e o que não entrou). */
export function titles(r: ToolResult): string[] {
  if (!r.ok) return [];
  return (r.data.grupos ?? []).flatMap((g) => g.itens.map((i) => i.titulo));
}
