export type Rule = { pattern: string; category_id: string };

/** minúsculas, sem acento e com espaços simples */
export function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Categoria da regra cujo padrão aparece na descrição. Padrão mais longo vence (mais específico). */
export function matchCategory(description: string, rules: Rule[]): string | null {
  const text = normalizeText(description);
  let best: Rule | null = null;
  for (const r of rules) {
    const p = normalizeText(r.pattern);
    if (p && text.includes(p) && (!best || p.length > normalizeText(best.pattern).length)) best = r;
  }
  return best?.category_id ?? null;
}
