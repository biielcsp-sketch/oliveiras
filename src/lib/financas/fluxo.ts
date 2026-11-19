import { classifyFlow } from "./summary";
import type { Category } from "./types";

export type Fluxo = "entradas" | "saidas";
export const FLUXOS: { value: Fluxo; label: string; optionLabel: string; empty: string }[] = [
  { value: "entradas", label: "Entradas", optionLabel: "Só entradas", empty: "Nenhuma entrada neste mês com esses filtros." },
  { value: "saidas", label: "Saídas", optionLabel: "Só saídas", empty: "Nenhuma saída neste mês com esses filtros." },
];

/** Valida `?fluxo=`: só `entradas` ou `saidas`; qualquer outro valor é ignorado. */
export function parseFluxo(v: string | undefined | null): Fluxo | undefined {
  return v === "entradas" || v === "saidas" ? v : undefined;
}

/**
 * Mantém só entradas ou só saídas pelo mesmo critério de `summarize`
 * (transferências, pares e crédito sem categoria em cartão ficam fora de ambos).
 */
export function filterByFluxo<T extends { amount: number; category_id: string | null; account_id: string; transfer_group?: string | null }>(
  rows: T[],
  fluxo: Fluxo | undefined,
  categories: { id: string; kind: Category["kind"] }[],
  cardAccountIds: Set<string> = new Set(),
): T[] {
  if (!fluxo) return rows;
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  const want = fluxo === "entradas" ? "income" : "expense";
  return rows.filter((t) => classifyFlow(t, kindById, cardAccountIds) === want);
}
