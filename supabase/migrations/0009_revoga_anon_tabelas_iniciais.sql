-- Defesa em profundidade: o papel anon não precisa de nenhum privilégio nas
-- tabelas iniciais (o RLS já barra, mas os default privileges do Supabase
-- davam "all" a anon). Não altera authenticated, políticas RLS nem funções.
-- Mesmo padrão de 0007_agenda.sql (seção Grants).
-- Rollback: rollbacks/0009_revoga_anon_tabelas_iniciais.rollback.sql

revoke all on
  public.households,
  public.household_users,
  public.members,
  public.fin_accounts,
  public.fin_categories,
  public.fin_transactions,
  public.fin_rules,
  public.fin_budgets,
  public.fin_bills,
  public.fin_bill_payments,
  public.fin_goals,
  public.fin_pluggy_items
from anon;
