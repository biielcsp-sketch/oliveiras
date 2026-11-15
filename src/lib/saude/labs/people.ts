import { UUID_RE } from "@/lib/saude/files";

export type PersonOption = { id: string; name: string };

/**
 * Pessoa do filtro (?pessoa=<id>). Só vale quem tem exame; valor inválido é ignorado.
 * `allowAll`: "todos" (null) é permitido (resumo e orientações). Sem `allowAll`, cai em quem está logado (se tem
 * exame) ou na primeira pessoa com exame, porque a evolução compara coletas de UMA pessoa.
 */
export function resolvePerson(param: unknown, withReports: PersonOption[], meId: string | null, allowAll: boolean): string | null {
  const ids = new Set(withReports.map((p) => p.id));
  if (typeof param === "string" && UUID_RE.test(param) && ids.has(param.toLowerCase())) return param.toLowerCase();
  if (allowAll) return null;
  if (meId && ids.has(meId)) return meId;
  return withReports[0]?.id ?? null;
}
