import "server-only";
import { getFinanceBase, getTransactions } from "./data";
import { summarize } from "./summary";

/**
 * Resultado do mês para o painel do Início: as mesmas consultas e o mesmo cálculo (`summarize`) do resumo
 * das Finanças, com a sessão do usuário (RLS). Sem contas cadastradas (ou sem acesso), `hasAccounts` é false.
 */
export async function getMonthSummary(month: string) {
  const [{ accounts, categories }, transactions] = await Promise.all([getFinanceBase(), getTransactions({ month })]);
  if (accounts.length === 0) return { hasAccounts: false as const };
  const cardIds = new Set(accounts.filter((a) => a.kind === "cartao").map((a) => a.id));
  const { income, expense, result } = summarize(transactions, categories, cardIds);
  return { hasAccounts: true as const, income, expense, result };
}
