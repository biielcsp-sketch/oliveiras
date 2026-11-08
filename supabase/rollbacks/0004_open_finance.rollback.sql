-- Rollback de 0004. Apaga conexões Pluggy e desfaz o vínculo das contas.
-- Os lançamentos importados (source = 'openfinance') continuam nas contas.
drop index if exists public.fin_accounts_external_idx;
alter table public.fin_accounts
  drop constraint if exists fin_accounts_pluggy_item_fkey,
  drop column if exists pluggy_item_ref,
  drop column if exists sync_from,
  drop column if exists bank_balance,
  drop column if exists bank_balance_at;
drop table if exists public.fin_pluggy_items;
