import type { Account, AccountKind } from "./types";

const cents = (v: number) => Math.round(v * 100);

/** Contas bancárias (tudo que não é cartão) e cartões, mantendo a ordem recebida. */
export function splitAccounts<T extends { kind: AccountKind }>(accounts: T[]): { banks: T[]; cards: T[] } {
  return { banks: accounts.filter((a) => a.kind !== "cartao"), cards: accounts.filter((a) => a.kind === "cartao") };
}

/** Dívida do cartão em positivo; saldo positivo é crédito na fatura, não dívida. */
export function debtOf(balance: number): number {
  return Math.max(0, -cents(balance)) / 100;
}

/** Totais do topo: disponível nas contas não-cartão e soma das faturas atuais (arquivadas ficam de fora). */
export function accountTotals(accounts: Pick<Account, "kind" | "balance" | "archived">[]): { available: number; cardDebt: number } {
  const { banks, cards } = splitAccounts(accounts.filter((a) => !a.archived));
  return {
    available: banks.reduce((s, a) => s + cents(a.balance), 0) / 100,
    cardDebt: cards.reduce((s, a) => s + Math.round(debtOf(a.balance) * 100), 0) / 100,
  };
}

/** Percentual do limite usado, com clamp 0–100. Sem limite válido: 0. */
export function limitUsedPercent(debt: number, limit: number | null): number {
  if (limit === null || !(limit > 0) || !Number.isFinite(debt)) return 0;
  return Math.min(100, Math.max(0, Math.round((debt / limit) * 100)));
}

/** Limite disponível em reais (pode ficar negativo se estourou). */
export function limitAvailable(debt: number, limit: number): number {
  return (cents(limit) - cents(debt)) / 100;
}

/** ?tipo= do formulário de nova conta: só "conta" e "cartao" valem; o resto mantém o padrão. */
export function kindFromTipo(tipo: string | string[] | undefined): AccountKind | null {
  if (tipo === "conta") return "corrente";
  if (tipo === "cartao") return "cartao";
  return null;
}

/** Inicial maiúscula para o círculo-logo. */
export function accountInitial(a: { name: string; institution: string | null }): string {
  const src = (a.institution?.trim() || a.name.trim());
  const ch = Array.from(src)[0];
  return ch ? ch.toLocaleUpperCase("pt-BR") : "?";
}

const LOGO_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2", "#4f46e5", "#b45309"];

/** Cor estável por texto (soma simples dos códigos), sem imagem externa. */
export function logoColor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return LOGO_COLORS[h % LOGO_COLORS.length];
}
