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

/** Normaliza e troca tudo que não é letra ou número por espaço (base da comparação por palavras inteiras). */
export function wordText(s: string) {
  return normalizeText(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** true se `pattern` aparece em `text` como palavra(s) inteira(s). */
export function containsWords(text: string, pattern: string) {
  const p = wordText(pattern);
  return p.length > 0 && ` ${wordText(text)} `.includes(` ${p} `);
}

/**
 * Categoria da regra cujo padrão aparece na descrição como PALAVRAS INTEIRAS
 * ('IFD*IFOOD' casa 'ifood'; 'otimo' não casa 'tim'). Testa o texto normalizado e também
 * cleanDescription(texto), para a regra aprendida sempre casar com a descrição de onde veio
 * ('LOJA 123 CENTRO' → regra 'loja centro'). Padrão mais longo vence (mais específico).
 */
export function matchCategory(description: string, rules: Rule[]): string | null {
  const texts = [` ${wordText(description)} `, ` ${cleanDescription(description)} `];
  let best: { len: number; id: string } | null = null;
  for (const r of rules) {
    const p = wordText(r.pattern);
    if (p && texts.some((t) => t.includes(` ${p} `)) && (!best || p.length > best.len)) best = { len: p.length, id: r.category_id };
  }
  return best?.id ?? null;
}

/**
 * Prefixos genéricos de extrato, tirados só do COMEÇO da descrição (repetidamente) e só enquanto sobra
 * outra palavra: bandeira/modalidade ('compra', 'elo', 'visa', 'master', 'debito', 'credito', 'vista') e
 * marcas de intermediário de pagamento que vêm antes do nome da loja ('dl', 'ifd', 'pg', 'pag',
 * 'pagseguro', 'mp'). 'pix', 'ted', 'enviado', 'recebido' e nomes de pessoas ficam: são informativos.
 */
const GENERIC_PREFIXES = new Set([
  "compra", "compras", "elo", "visa", "master", "mastercard", "maestro", "debito", "credito",
  "vista", "dl", "ifd", "pg", "pag", "pagseguro", "mp",
]);

/**
 * Chave estável de uma descrição, para aprender categorias ("parecidos") e virar texto de regra.
 * - normaliza (sem acento, minúsculas), troca pontuação e '*' por espaço;
 * - tira datas (12/03, 12/03/2026), marcas de parcela ('02/10', 'parc 3', 'parcela 3 de 10', '3x') e horas;
 * - tira números com 3+ dígitos (documento, terminal, loja) e números de 1–2 dígitos, exceto quando são a
 *   primeira palavra seguida de outra (marca como '99 ride');
 * - tira os prefixos genéricos acima; colapsa espaços; corta em 60.
 * Retorna '' se sobrar menos de 2 letras.
 */
export function cleanDescription(desc: string) {
  let s = normalizeText(desc)
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, " ") // datas e parcelas 02/10
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ") // horas
    .replace(/\bparc(ela)?s?\.?\s*\d+(\s*(de|\/)\s*\d+)?/g, " ")
    .replace(/\b\d+x\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // Números longos ou misturados com letras saem antes; prefixos depois; o número curto só fica se,
  // tirados os prefixos, for a primeira palavra ('dl 99 ride' → '99 ride').
  let words = (s ? s.split(" ") : []).filter((w) => !/\d/.test(w) || /^\d{1,2}$/.test(w));
  while (words.length > 1 && GENERIC_PREFIXES.has(words[0])) words.shift();
  const n = words.length;
  words = words.filter((w, i) => !/\d/.test(w) || (i === 0 && n > 1));
  while (words.length > 1 && GENERIC_PREFIXES.has(words[0])) words.shift();
  s = words.join(" ").slice(0, 60).trim();
  return (s.match(/[a-z]/g)?.length ?? 0) >= 2 ? s : "";
}

/**
 * Categoria da Pluggy (inglês, árvore em v2.docs.pluggy.ai/docs/transaction-categories) → nome da
 * categoria padrão do app. Transferência para terceiros ('Transfer - PIX', 'Third-party transfers'…) fica
 * de fora (null): não se sabe se é gasto ou repasse da família.
 */
const PLUGGY_MAP: Record<string, string> = {};
function put(app: string, ...pluggy: string[]) {
  for (const p of pluggy) PLUGGY_MAP[p.toLowerCase()] = app;
}
put("Pagamento Cartão de Crédito", "Credit card payment");
put("Transferência entre contas", "Same person transfer", "Same person transfer - PIX", "Same person transfer - TED", "Same person transfer - Cash", "Transfer - Internal");
put("Mercado", "Groceries");
put("Alimentação fora", "Food and drinks", "Eating out", "Food delivery");
put("Transporte", "Transportation", "Taxi and ride-hailing", "Public transportation", "Car rental", "Bicycle", "Automotive", "Gas stations", "Parking", "Tolls and in-vehicle payment", "Vehicle maintenance");
put("Saúde", "Healthcare", "Dentist", "Pharmacy", "Optometry", "Hospital clinics and labs", "Health insurance");
put("Educação", "Education", "Online Courses", "University", "School", "Kindergarten");
put("Assinaturas", "Digital services", "Video streaming", "Music streaming", "Gaming");
put("Contas da casa", "Telecommunications", "Internet", "Mobile", "TV", "Utilities", "Water", "Electricity", "Gas");
put("Moradia", "Housing", "Rent", "Houseware", "Urban land and building tax");
put("Igreja e doações", "Donations");
put("Impostos e taxas", "Taxes", "Income taxes", "Taxes on investments", "Tax on financial operations", "Bank fees", "Account fees", "Wire transfer fees and ATM fees", "Credit card fees");
put("Vestuário", "Clothing");
put("Filho", "Kids and toys");
put("Cuidados pessoais", "Wellness and fitness", "Gyms and fitness centers", "Wellness");
put("Lazer", "Leisure", "Tickets", "Cinema, theater and concerts", "Travel", "Accommodation", "Airport and airlines");
put("Salário", "Salary");
put("Rendimentos", "Proceeds interests and dividends");
put("Aplicação e resgate", "Investments", "Automatic investment", "Fixed income", "Mutual funds", "Variable income");

export function pluggyToAppCategoryName(pluggyCategory: string | null | undefined): string | null {
  if (!pluggyCategory) return null;
  return PLUGGY_MAP[pluggyCategory.trim().toLowerCase()] ?? null;
}

export type CategorySource = "manual" | "regra" | "historico" | "pluggy" | "par";

export type CategorizeCtx = {
  rules: Rule[];
  /** cleanDescription → category_id (ver buildHistory) */
  history: Map<string, string>;
  /** nome da categoria → id (aceita nome exato ou normalizado; ver categoryIdsByName) */
  categoryIdByName: Map<string, string>;
};

/** Mapa nome → id com o nome exato e o normalizado. */
export function categoryIdsByName(categories: { id: string; name: string }[]) {
  const m = new Map<string, string>();
  for (const c of categories) {
    m.set(c.name, c.id);
    m.set(normalizeText(c.name), c.id);
  }
  return m;
}

/** Ordem: regra → histórico (correções da família) → categoria da Pluggy (se existir na família) → nada. */
export function categorize(
  tx: { description: string; pluggyCategory?: string | null },
  ctx: CategorizeCtx,
): { category_id: string | null; category_source: "regra" | "historico" | "pluggy" | null } {
  const byRule = matchCategory(tx.description, ctx.rules);
  if (byRule) return { category_id: byRule, category_source: "regra" };
  const key = cleanDescription(tx.description);
  const byHistory = key ? ctx.history.get(key) : undefined;
  if (byHistory) return { category_id: byHistory, category_source: "historico" };
  const name = pluggyToAppCategoryName(tx.pluggyCategory);
  const byPluggy = name ? (ctx.categoryIdByName.get(name) ?? ctx.categoryIdByName.get(normalizeText(name))) : undefined;
  if (byPluggy) return { category_id: byPluggy, category_source: "pluggy" };
  return { category_id: null, category_source: null };
}

/**
 * Histórico para aprender: só linhas categorizadas pela própria família (category_source 'manual' ou
 * null = legado). Para cada chave cleanDescription, a categoria mais frequente; no empate vence a que
 * apareceu primeiro na lista — quem chama passa as linhas da mais recente para a mais antiga, então
 * empate = categoria usada mais recentemente.
 */
export function buildHistory(
  rows: { description: string; category_id: string | null; category_source: string | null }[],
): Map<string, string> {
  const counts = new Map<string, Map<string, { n: number; first: number }>>();
  rows.forEach((r, i) => {
    if (!r.category_id) return;
    if (r.category_source !== null && r.category_source !== "manual") return;
    const key = cleanDescription(r.description);
    if (!key) return;
    const byCat = counts.get(key) ?? new Map<string, { n: number; first: number }>();
    const c = byCat.get(r.category_id) ?? { n: 0, first: i };
    c.n++;
    byCat.set(r.category_id, c);
    counts.set(key, byCat);
  });
  const out = new Map<string, string>();
  for (const [key, byCat] of counts) {
    let best: [string, { n: number; first: number }] | null = null;
    for (const e of byCat) if (!best || e[1].n > best[1].n || (e[1].n === best[1].n && e[1].first < best[1].first)) best = e;
    if (best) out.set(key, best[0]);
  }
  return out;
}

export const EMPTY_CTX: CategorizeCtx = { rules: [], history: new Map(), categoryIdByName: new Map() };
