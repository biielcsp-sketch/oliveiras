-- anon sem nenhum privilégio nas tabelas iniciais (0009); authenticated mantém select.
begin;
select plan(36);

-- 1) anon é barrado por permissão (42501), não só pelo RLS
set local role anon;
select throws_ok($$ select count(*) from public.households $$, '42501', null, 'anon não lê households');
select throws_ok($$ select count(*) from public.household_users $$, '42501', null, 'anon não lê household_users');
select throws_ok($$ select count(*) from public.members $$, '42501', null, 'anon não lê members');
select throws_ok($$ select count(*) from public.fin_accounts $$, '42501', null, 'anon não lê fin_accounts');
select throws_ok($$ select count(*) from public.fin_categories $$, '42501', null, 'anon não lê fin_categories');
select throws_ok($$ select count(*) from public.fin_transactions $$, '42501', null, 'anon não lê fin_transactions');
select throws_ok($$ select count(*) from public.fin_rules $$, '42501', null, 'anon não lê fin_rules');
select throws_ok($$ select count(*) from public.fin_budgets $$, '42501', null, 'anon não lê fin_budgets');
select throws_ok($$ select count(*) from public.fin_bills $$, '42501', null, 'anon não lê fin_bills');
select throws_ok($$ select count(*) from public.fin_bill_payments $$, '42501', null, 'anon não lê fin_bill_payments');
select throws_ok($$ select count(*) from public.fin_goals $$, '42501', null, 'anon não lê fin_goals');
select throws_ok($$ select count(*) from public.fin_pluggy_items $$, '42501', null, 'anon não lê fin_pluggy_items');
reset role;

-- 2) anon sem select/insert/update/delete em cada tabela
select ok(
  not has_table_privilege('anon', 'public.' || t, 'select')
  and not has_table_privilege('anon', 'public.' || t, 'insert')
  and not has_table_privilege('anon', 'public.' || t, 'update')
  and not has_table_privilege('anon', 'public.' || t, 'delete'),
  'anon sem select/insert/update/delete em ' || t)
from unnest(array['households','household_users','members','fin_accounts','fin_categories',
  'fin_transactions','fin_rules','fin_budgets','fin_bills','fin_bill_payments','fin_goals',
  'fin_pluggy_items']) as t;

-- 3) authenticated continua com select
select ok(has_table_privilege('authenticated', 'public.' || t, 'select'),
  'authenticated mantém select em ' || t)
from unnest(array['households','household_users','members','fin_accounts','fin_categories',
  'fin_transactions','fin_rules','fin_budgets','fin_bills','fin_bill_payments','fin_goals',
  'fin_pluggy_items']) as t;

select * from finish();
rollback;
