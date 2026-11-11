-- Baixa automática: fin_bill_payments.auto e fin_baixa_dismissals (isolamento
-- por família, FKs compostas, unique, checks, anon).
begin;
select plan(26);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'ea@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'eb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;

insert into public.fin_accounts (household_id, name, kind) values
  (current_setting('t.ha')::uuid, 'Conta A', 'corrente'),
  (current_setting('t.hb')::uuid, 'Conta B', 'corrente');
select set_config('t.acc_a', (select id::text from public.fin_accounts where household_id = current_setting('t.ha')::uuid and name = 'Conta A'), true);
select set_config('t.acc_b', (select id::text from public.fin_accounts where household_id = current_setting('t.hb')::uuid and name = 'Conta B'), true);
insert into public.fin_bills (household_id, name, amount, due_day) values
  (current_setting('t.ha')::uuid, 'Luz A', 200, 10),
  (current_setting('t.ha')::uuid, 'Água A', 80, 15),
  (current_setting('t.hb')::uuid, 'Luz B', 300, 10);
select set_config('t.bill_a', (select id::text from public.fin_bills where name = 'Luz A'), true);
select set_config('t.bill_a2', (select id::text from public.fin_bills where name = 'Água A'), true);
select set_config('t.bill_b', (select id::text from public.fin_bills where name = 'Luz B'), true);
insert into public.fin_transactions (household_id, account_id, date, description, amount) values
  (current_setting('t.ha')::uuid, current_setting('t.acc_a')::uuid, '2026-11-10', 'Tx A', -200),
  (current_setting('t.hb')::uuid, current_setting('t.acc_b')::uuid, '2026-11-10', 'Tx B', -300);
select set_config('t.tx_a', (select id::text from public.fin_transactions where description = 'Tx A'), true);
select set_config('t.tx_b', (select id::text from public.fin_transactions where description = 'Tx B'), true);

-- 00_helpers
select ok((select relrowsecurity from pg_class where oid = 'public.fin_baixa_dismissals'::regclass), 'fin_baixa_dismissals tem RLS ligado');

-- fin_bill_payments.auto ---------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into public.fin_bill_payments (household_id, bill_id, month, paid_on, amount)
  values (%L, %L, '2026-10', '2026-10-10', 200) $$, current_setting('t.ha'), current_setting('t.bill_a')), 'baixa sem auto');
select is((select auto from public.fin_bill_payments where month = '2026-10'), false, 'auto tem default false');
select lives_ok(format($$ insert into public.fin_bill_payments (household_id, bill_id, month, paid_on, amount, transaction_id, auto)
  values (%L, %L, '2026-11', '2026-11-10', 200, %L, true) $$, current_setting('t.ha'), current_setting('t.bill_a'), current_setting('t.tx_a')), 'baixa automática');
select is((select auto from public.fin_bill_payments where month = '2026-11'), true, 'auto = true persiste');
select throws_ok(format($$ update public.fin_bill_payments set auto = null where month = '2026-11' and household_id = %L $$, current_setting('t.ha')),
  '23502', null, 'auto não aceita null');

-- membro: cria, lê, altera, apaga ----------------------------------------------------
select lives_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.ha'), current_setting('t.bill_a'), current_setting('t.tx_a')), 'A cria recusa');
select set_config('t.d_a', (select id::text from public.fin_baixa_dismissals limit 1), true);
select is((select count(*)::int from public.fin_baixa_dismissals), 1, 'A lê a recusa');
select is((select created_by from public.fin_baixa_dismissals), '00000000-0000-0000-0000-0000000000e1'::uuid, 'created_by = auth.uid()');
select throws_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'desfeita') $$, current_setting('t.ha'), current_setting('t.bill_a'), current_setting('t.tx_a')),
  '23505', null, 'unique: mesmo par conta x lançamento não repete');
select lives_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'desfeita') $$, current_setting('t.ha'), current_setting('t.bill_a2'), current_setting('t.tx_a')),
  'mesmo lançamento com outra conta é aceito');
select throws_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'talvez') $$, current_setting('t.ha'), current_setting('t.bill_a2'), current_setting('t.tx_a')),
  '23514', null, 'reason fora da lista');
select lives_ok(format($$ update public.fin_baixa_dismissals set reason = 'desfeita' where id = %L $$, current_setting('t.d_a')), 'A altera recusa');

-- FKs compostas ----------------------------------------------------------------------
select throws_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.ha'), current_setting('t.bill_b'), current_setting('t.tx_a')),
  '23503', null, 'FK composta: bill_id de B é rejeitado');
select throws_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.ha'), current_setting('t.bill_a2'), current_setting('t.tx_b')),
  '23503', null, 'FK composta: transaction_id de B é rejeitado');

-- outra família ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from public.fin_baixa_dismissals), 0, 'B não lê recusas de A');
select throws_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.ha'), current_setting('t.bill_a2'), current_setting('t.tx_a')),
  '42501', null, 'B não insere recusa em A');
select throws_ok(format($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.hb'), current_setting('t.bill_b'), current_setting('t.tx_a')),
  '23503', null, 'B não liga recusa a lançamento de A');
select is_empty(format($$ update public.fin_baixa_dismissals set reason = 'nao_e' where id = %L returning 1 $$, current_setting('t.d_a')), 'B não altera recusa de A');
select is_empty(format($$ delete from public.fin_baixa_dismissals where id = %L returning 1 $$, current_setting('t.d_a')), 'B não apaga recusa de A');

-- apagar (membro) e cascade ---------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ delete from public.fin_baixa_dismissals where id = %L $$, current_setting('t.d_a')), 'A apaga recusa');
select lives_ok(format($$ delete from public.fin_bills where id = %L $$, current_setting('t.bill_a2')), 'A apaga a conta Água');
select is((select count(*)::int from public.fin_baixa_dismissals), 0, 'recusa some junto com a conta (cascade)');

-- anon ---------------------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.fin_baixa_dismissals $$, '42501', null, 'anon não lê fin_baixa_dismissals');
select throws_ok($$ insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'nao_e') $$, '42501', null, 'anon não insere fin_baixa_dismissals');
select throws_ok($$ delete from public.fin_baixa_dismissals $$, '42501', null, 'anon não apaga fin_baixa_dismissals');
reset role;

select * from finish();
rollback;
