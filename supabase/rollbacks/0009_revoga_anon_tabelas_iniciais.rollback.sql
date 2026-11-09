-- Rollback de 0009: devolve a anon os privilégios que vinham dos default
-- privileges do Supabase (all) nas 12 tabelas iniciais.
grant all on
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
to anon;
