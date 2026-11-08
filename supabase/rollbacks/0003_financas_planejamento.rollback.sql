-- Rollback de 0003. ATENÇÃO: apaga orçamentos, contas a pagar, pagamentos e metas.
drop table if exists public.fin_goals;
drop table if exists public.fin_bill_payments;
drop table if exists public.fin_bills;
drop table if exists public.fin_budgets;
drop index if exists public.fin_transactions_created_by_idx;
drop index if exists public.households_created_by_idx;
drop index if exists public.members_user_idx;
alter table public.fin_transactions drop constraint if exists fin_transactions_id_household_key;
