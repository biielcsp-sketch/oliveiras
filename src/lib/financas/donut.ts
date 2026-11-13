/** Tons de azul das fatias (a legenda sempre traz nome e porcentagem: a cor não é a única informação). */
export const DONUT_COLORS = ["#0A47AE", "#2F7FE6", "#7FC0F5", "#5B6BD6", "#A9C8F5"];

export type DonutSlice = {
  key: string;
  categoryId: string | null;
  label: string;
  total: number;
  /** porcentagem inteira; a soma das fatias dá 100 */
  pct: number;
  color: string;
  /** traço e deslocamento no círculo de circunferência 100 (r = 15,9) */
  dash: string;
  offset: number;
};

/**
 * Fatias do donut "Despesas por categoria" a partir dos gastos por categoria já calculados no resumo
 * (`summarize().expenseByCategory`, em ordem decrescente). As `max` maiores ganham fatia própria; o resto vira "Outros".
 * Porcentagens arredondadas pelo maior resto, para somarem exatamente 100.
 */
export function donutSlices(
  byCategory: { category_id: string | null; total: number }[],
  nameOf: (id: string | null) => string,
  max = 4,
): DonutSlice[] {
  const items = byCategory.filter((c) => c.total > 0);
  const totalCents = items.reduce((s, c) => s + Math.round(c.total * 100), 0);
  if (totalCents === 0) return [];
  const head = items.length > max + 1 ? items.slice(0, max) : items;
  const rest = items.length > max + 1 ? items.slice(max) : [];
  const groups = head.map((c) => ({ key: c.category_id ?? "sem", categoryId: c.category_id, label: nameOf(c.category_id), cents: Math.round(c.total * 100) }));
  if (rest.length) groups.push({ key: "outros", categoryId: null, label: "Outros", cents: rest.reduce((s, c) => s + Math.round(c.total * 100), 0) });

  const raw = groups.map((g) => (g.cents * 100) / totalCents);
  const pcts = raw.map(Math.floor);
  let missing = 100 - pcts.reduce((s, p) => s + p, 0);
  raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (missing > 0) {
        pcts[i] += 1;
        missing -= 1;
      }
    });

  let acc = 0;
  return groups.map((g, i) => {
    const slice: DonutSlice = {
      key: g.key,
      categoryId: g.categoryId,
      label: g.label,
      total: g.cents / 100,
      pct: pcts[i],
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      dash: `${pcts[i]} ${100 - pcts[i]}`,
      offset: acc === 0 ? 0 : -acc,
    };
    acc += pcts[i];
    return slice;
  });
}
