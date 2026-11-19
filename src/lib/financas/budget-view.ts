/** Lógica pura da tela de Orçamento: status das metas, ordem dos blocos, rosca de gastos e abreviação de valores. */

export type BudgetStatus = "sem-meta" | "ok" | "atencao" | "estourou";

/** Limiares: até 80% da meta = ok; de 80% a 100% (inclusive) = atenção; acima de 100% = estourou. Sem meta (<= 0) = "sem-meta". */
export const WARN_AT = 0.8;

export function budgetStatus(spent: number, amount: number | null | undefined): BudgetStatus {
  if (!(amount && amount > 0)) return "sem-meta";
  const ratio = Math.round(spent * 100) / Math.round(amount * 100);
  if (ratio > 1) return "estourou";
  if (ratio >= WARN_AT) return "atencao";
  return "ok";
}

export type BudgetBlock = {
  categoryId: string;
  name: string;
  color: string;
  spent: number;
  /** null: categoria sem meta */
  amount: number | null;
  override: boolean;
  status: BudgetStatus;
  /** gasto ÷ meta (0 sem meta) */
  ratio: number;
};

/**
 * Blocos da grade de categorias. Categoria sem meta e sem gasto some.
 * Ordem: estouradas (maior proporção primeiro), depois as demais com meta por proporção desc, depois as sem meta por gasto desc.
 */
export function budgetBlocks(
  cats: { id: string; name: string; color: string }[],
  budgets: Map<string, { amount: number; override: boolean }>,
  spentBy: Map<string | null, number>,
): BudgetBlock[] {
  const blocks: BudgetBlock[] = [];
  for (const c of cats) {
    const b = budgets.get(c.id);
    const amount = b && b.amount > 0 ? b.amount : null;
    const spent = Math.round((spentBy.get(c.id) ?? 0) * 100) / 100;
    if (amount === null && !(spent > 0)) continue;
    blocks.push({
      categoryId: c.id,
      name: c.name,
      color: c.color,
      spent,
      amount,
      override: !!b?.override,
      status: budgetStatus(spent, amount),
      ratio: amount ? spent / amount : 0,
    });
  }
  const rank = (b: BudgetBlock) => (b.status === "estourou" ? 0 : b.amount !== null ? 1 : 2);
  return blocks.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (a.amount === null) return b.spent - a.spent || a.name.localeCompare(b.name, "pt-BR");
    return b.ratio - a.ratio || a.name.localeCompare(b.name, "pt-BR");
  });
}

/** Paleta fixa da rosca (vivas, legíveis no claro e no escuro). A última é "Outras". */
export const SPEND_COLORS = ["#2F7FE6", "#F2994A", "#27AE60", "#9B51E0"] as const;
export const OTHERS_COLOR = "#8A94A6";

export type SpendSegment = {
  key: string;
  categoryId: string | null;
  label: string;
  total: number;
  /** fração da circunferência (100 = volta inteira); a soma das fatias dá 100 */
  arc: number;
  color: string;
  /** traço visível, no círculo de circunferência 100 */
  length: number;
  /** espaço deixado entre esta fatia e a próxima */
  gap: number;
  /** stroke-dashoffset (negativo = avança no sentido horário a partir do topo) */
  offset: number;
};

/** Rosca "Seus gastos do mês": as 4 maiores categorias e "Outras". Total zero (ou vazio) devolve []. */
export function spendSegments(
  byCategory: { category_id: string | null; total: number }[],
  nameOf: (id: string | null) => string,
  max = 4,
): SpendSegment[] {
  const items = byCategory.filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const totalCents = items.reduce((s, c) => s + Math.round(c.total * 100), 0);
  if (totalCents === 0) return [];
  const groups = items.slice(0, max).map((c, i) => ({
    key: c.category_id ?? "sem",
    categoryId: c.category_id,
    label: nameOf(c.category_id),
    cents: Math.round(c.total * 100),
    color: SPEND_COLORS[i % SPEND_COLORS.length] as string,
  }));
  if (items.length > max) {
    groups.push({
      key: "outras",
      categoryId: null,
      label: "Outras",
      cents: items.slice(max).reduce((s, c) => s + Math.round(c.total * 100), 0),
      color: OTHERS_COLOR,
    });
  }
  let acc = 0;
  return groups.map((g) => {
    const arc = (g.cents * 100) / totalCents;
    const gap = groups.length > 1 ? Math.min(1.2, arc / 2) : 0;
    const seg: SpendSegment = {
      key: g.key,
      categoryId: g.categoryId,
      label: g.label,
      total: g.cents / 100,
      arc,
      color: g.color,
      length: arc - gap,
      gap,
      offset: acc === 0 ? 0 : -acc,
    };
    acc += arc;
    return seg;
  });
}

/** "R$ 850", "R$ 3,1 mil", "R$ 1,2 mi" para o centro da rosca. */
export function abbreviateBRL(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const fmt = (n: number) => n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  if (abs < 1000) return `${sign}R$ ${Math.round(abs).toLocaleString("pt-BR")}`;
  const mil = Math.round((abs / 1000) * 10) / 10;
  if (mil < 1000) return `${sign}R$ ${fmt(mil)} mil`;
  return `${sign}R$ ${fmt(Math.round((abs / 1_000_000) * 10) / 10)} mi`;
}
