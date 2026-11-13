// Chama a ferramenta do Oli (server action runOliTool) como a tela faz, com a sessão do navegador.
// Não há Gemini Live simulado: o modelo é substituído pelo teste, que pede a ferramenta direto.
// O id da action vem do manifesto do build (o mesmo que a tela usa), nunca de um endpoint de teste no app.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const actionIds = new Map<string, string>();

/** Id de uma action exportada por oli-actions.ts (runOliTool, confirmOli*), lido do manifesto do build. */
function oliActionId(exportedName: string) {
  const cached = actionIds.get(exportedName);
  if (cached) return cached;
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
    node: Record<string, { filename?: string; exportedName?: string }>;
  };
  const found = Object.entries(manifest.node).find(
    ([, v]) => v.filename?.endsWith("src/app/(app)/inicio/oli-actions.ts") && v.exportedName === exportedName,
  );
  if (!found) throw new Error(`${exportedName} não está no manifesto do build (rode npm run build).`);
  actionIds.set(exportedName, found[0]);
  return found[0];
}

export type ToolResult = { ok: true; tool: string; data: Record<string, unknown> & { grupos?: { titulo: string; total: number; itens: { titulo: string; pessoa: string | null; arquivo: string | null }[] }[]; aviso?: string | null } } | { ok: false; erro: string };

/** POST da server action na página /assistente (tela do Oli) (mesma origem e cookies da página). */
export async function callOliTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await callOliAction(page, "runOliTool", [name, args])) as ToolResult;
}

/** Qualquer action de oli-actions.ts, como a tela chama (ex.: confirmOliAlteracao com o painel recebido). */
export async function callOliAction(page: Page, exportedName: string, args: unknown[]): Promise<unknown> {
  const res = await page.request.post("/assistente", {
    headers: { "Next-Action": oliActionId(exportedName), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  if (res.status() !== 200) throw new Error(`action respondeu ${res.status()}`);
  const text = await res.text();
  // Resposta RSC: linhas "<id>:<json>"; o resultado da action é a linha 1 (a 0 aponta para ela).
  for (const line of text.split("\n")) {
    const m = /^1:(.*)$/.exec(line);
    if (m) return JSON.parse(m[1]) as unknown;
  }
  throw new Error(`resposta inesperada da action: ${text.slice(0, 200)}`);
}

/** Títulos de todos os itens de uma consulta (para conferir o que entrou e o que não entrou). */
export function titles(r: ToolResult): string[] {
  if (!r.ok) return [];
  return (r.data.grupos ?? []).flatMap((g) => g.itens.map((i) => i.titulo));
}
