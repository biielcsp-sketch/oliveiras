-- Orçamento, contas a pagar, pagamentos e metas: isolamento e integridade.
begin;
select plan(18);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'pa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'pb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);

reset role;
select set_config('t.cat_b', (select id::text from public.fin_categories where household_id = current_setting('t.hb')::uuid and name = 'Moradia'), true);
select set_config('t.cat_a', (select id::text from public.fin_categories where household_id = current_setting('t.ha')::uuid and name = 'Moradia'), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');

-- B: conta, lançamento, orçamento, conta a pagar, pagamento e meta
insert into public.fin_accounts (household_id, name, kind, opening_balance) values (current_setting('t.hb')::uuid, 'Conta B', 'corrente', 5000);
reset role;
select set_config('t.acc_b', (select id::text from public.fin_accounts where household_id = current_setting('t.hb')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
insert into public.fin_transactions (household_id, account_id, date, description, amount)
  values (current_setting('t.hb')::uuid, current_setting('t.acc_b')::uuid, '2026-11-05', 'ALUGUEL', -1800),
         (current_setting('t.hb')::uuid, current_setting('t.acc_b')::uuid, '2026-11-10', 'LUZ', -200);
reset role;
select set_config('t.tx_b', (select id::text from public.fin_transactions where household_id = current_setting('t.hb')::uuid and description = 'ALUGUEL'), true);
select set_config('t.tx_b2', (select id::text from public.fin_transactions where household_id = current_setting('t.hb')::uuid and description = 'LUZ'), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');

select lives_ok(format($$ insert into public.fin_budgets (household_id, category_id, month, amount) values
  (%L, %L, null, 1800), (%L, %L, '2026-12', 2000) $$,
  current_setting('t.hb'), current_setting('t.cat_b'), current_setting('t.hb'), current_setting('t.cat_b')),
  'B define orçamento padrão e ajuste de dezembro');
select throws_ok(format($$ insert into public.fin_budgets (household_id, category_id, month, amount) values (%L, %L, null, 1) $$,
  current_setting('t.hb'), current_setting('t.cat_b')), '23505', null, 'só um orçamento padrão por categoria');
select throws_ok(format($$ insert into public.fin_budgets (household_id, category_id, month, amount) values (%L, %L, '2026-13', 1) $$,
  current_setting('t.hb'), current_setting('t.cat_b')), '23514', null, 'mês inválido é recusado');

select lives_ok(format($$ insert into public.fin_bills (household_id, name, amount, due_day, category_id, account_id)
  values (%L, 'Aluguel', 1800, 5, %L, %L) $$, current_setting('t.hb'), current_setting('t.cat_b'), current_setting('t.acc_b')),
  'B cria conta a pagar');
reset role;
select set_config('t.bill_b', (select id::text from public.fin_bills where household_id = current_setting('t.hb')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');

select lives_ok(format($$ insert into public.fin_bill_payments (household_id, bill_id, month, transaction_id, paid_on, amount)
  values (%L, %L, '2026-11', %L, '2026-11-05', 1800) $$, current_setting('t.hb'), current_setting('t.bill_b'), current_setting('t.tx_b')),
  'B marca aluguel de novembro como pago, ligado ao lançamento');
select throws_ok(format($$ insert into public.fin_bill_payments (household_id, bill_id, month, paid_on, amount)
  values (%L, %L, '2026-11', '2026-11-06', 1800) $$, current_setting('t.hb'), current_setting('t.bill_b')),
  '23505', null, 'mesma conta não é paga duas vezes no mês');

select lives_ok(format($$ insert into public.fin_goals (household_id, name, target, account_id) values (%L, 'Reserva', 30000, %L) $$,
  current_setting('t.hb'), current_setting('t.acc_b')), 'B cria meta');

-- A não vê nada de B
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is((select count(*)::int from public.fin_budgets where household_id = current_setting('t.hb')::uuid), 0, 'A não vê orçamento de B');
select is((select count(*)::int from public.fin_bills where household_id = current_setting('t.hb')::uuid), 0, 'A não vê contas a pagar de B');
select is((select count(*)::int from public.fin_bill_payments where household_id = current_setting('t.hb')::uuid), 0, 'A não vê pagamentos de B');
select is((select count(*)::int from public.fin_goals where household_id = current_setting('t.hb')::uuid), 0, 'A não vê metas de B');

-- A não escreve em B nem liga dados de B aos seus
select throws_ok(format($$ insert into public.fin_bills (household_id, name, amount, due_day) values (%L, 'X', 1, 1) $$,
  current_setting('t.hb')), '42501', null, 'A não cria conta a pagar em B');
select throws_ok(format($$ insert into public.fin_budgets (household_id, category_id, amount) values (%L, %L, 1) $$,
  current_setting('t.ha'), current_setting('t.cat_b')), '23503', null, 'A não orça categoria de B');
select throws_ok(format($$ insert into public.fin_goals (household_id, name, target, account_id) values (%L, 'X', 1, %L) $$,
  current_setting('t.ha'), current_setting('t.acc_b')), '23503', null, 'A não usa conta de B em meta');
insert into public.fin_bills (household_id, name, amount, due_day) values (current_setting('t.ha')::uuid, 'Luz A', 200, 10);
reset role;
select set_config('t.bill_a', (select id::text from public.fin_bills where household_id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok(format($$ insert into public.fin_bill_payments (household_id, bill_id, month, transaction_id, paid_on, amount)
  values (%L, %L, '2026-11', %L, '2026-11-05', 200) $$, current_setting('t.ha'), current_setting('t.bill_a'), current_setting('t.tx_b2')),
  '23503', null, 'A não liga lançamento de B ao seu pagamento');
delete from public.fin_bills where household_id = current_setting('t.hb')::uuid;

-- Excluir o lançamento mantém o pagamento (vínculo vira nulo)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
delete from public.fin_transactions where id = current_setting('t.tx_b')::uuid;
reset role;
select is((select transaction_id from public.fin_bill_payments where bill_id = current_setting('t.bill_b')::uuid), null,
  'lançamento excluído: pagamento continua, sem vínculo');
select is((select count(*)::int from public.fin_bills where household_id = current_setting('t.hb')::uuid), 1, 'A não apaga conta a pagar de B');
select is((select count(*)::int from public.fin_budgets where household_id = current_setting('t.hb')::uuid), 2, 'orçamentos de B intactos');

select * from finish();
rollback;
