-- Contas avulsas (0021): RLS, isolamento por família, checks, unique do
-- lançamento, FKs compostas, documento fixa x avulsa e recusas do cruzamento.
begin;
select plan(37);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000021a1', 'avulsa-a@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000021b1', 'avulsa-b@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Estrutura: RLS ligado e nada para anon
select ok((select relrowsecurity from pg_class where oid = 'public.fin_one_off_bills'::regclass),
  'fin_one_off_bills com RLS ligado');
select ok((select relrowsecurity from pg_class where oid = 'public.fin_one_off_baixa_dismissals'::regclass),
  'fin_one_off_baixa_dismissals com RLS ligado');
select ok(not has_table_privilege('anon', 'public.fin_one_off_bills', 'select,insert,update,delete'),
  'anon sem privilégio em fin_one_off_bills');
select ok(not has_table_privilege('anon', 'public.fin_one_off_baixa_dismissals', 'select,insert,update,delete'),
  'anon sem privilégio em fin_one_off_baixa_dismissals');

-- Duas famílias, cada uma com conta, lançamentos e (A) uma conta fixa
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000021a1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000021b1');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;

insert into public.fin_accounts (household_id, name, kind) values
  (current_setting('t.ha')::uuid, 'Conta A', 'corrente'),
  (current_setting('t.hb')::uuid, 'Conta B', 'corrente');
select set_config('t.acc_a', (select id::text from public.fin_accounts where household_id = current_setting('t.ha')::uuid), true);
select set_config('t.acc_b', (select id::text from public.fin_accounts where household_id = current_setting('t.hb')::uuid), true);
select set_config('t.cat_a', (select id::text from public.fin_categories where household_id = current_setting('t.ha')::uuid and name = 'Moradia'), true);
select set_config('t.cat_b', (select id::text from public.fin_categories where household_id = current_setting('t.hb')::uuid and name = 'Moradia'), true);
insert into public.fin_transactions (household_id, account_id, date, description, amount) values
  (current_setting('t.ha')::uuid, current_setting('t.acc_a')::uuid, '2026-11-10', 'IPTU', -350),
  (current_setting('t.ha')::uuid, current_setting('t.acc_a')::uuid, '2026-11-11', 'Conserto', -120),
  (current_setting('t.hb')::uuid, current_setting('t.acc_b')::uuid, '2026-11-10', 'Outro', -50);
select set_config('t.tx1', (select id::text from public.fin_transactions where description = 'IPTU'), true);
select set_config('t.tx2', (select id::text from public.fin_transactions where description = 'Conserto'), true);
select set_config('t.txb', (select id::text from public.fin_transactions where description = 'Outro'), true);
insert into public.fin_bills (household_id, name, amount, due_day)
  values (current_setting('t.ha')::uuid, 'Luz', 200, 10);
select set_config('t.bill_a', (select id::text from public.fin_bills where household_id = current_setting('t.ha')::uuid), true);

-- Membro escreve e lê a própria família
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000021a1');
select lives_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, category_id, account_id, is_home)
  values (%L, 'IPTU 2026', 350, '2026-11-15', %L, %L, true) $$,
  current_setting('t.ha'), current_setting('t.cat_a'), current_setting('t.acc_a')), 'A cria avulsa');
select is((select count(*)::int from public.fin_one_off_bills), 1, 'A lê a própria avulsa');
select set_config('t.ob1', (select id::text from public.fin_one_off_bills where name = 'IPTU 2026'), true);
select is((select created_by::text from public.fin_one_off_bills where id = current_setting('t.ob1')::uuid),
  '00000000-0000-0000-0000-0000000021a1', 'created_by = auth.uid()');
select lives_ok(format($$ update public.fin_one_off_bills set paid_on = '2026-11-10', transaction_id = %L, paid_auto = true
  where id = %L $$, current_setting('t.tx1'), current_setting('t.ob1')), 'A marca a avulsa como paga pelo extrato');
select ok((select paid_auto from public.fin_one_off_bills where id = current_setting('t.ob1')::uuid), 'baixa automática gravada');

-- B cria a própria avulsa
select pg_temp.as_user('00000000-0000-0000-0000-0000000021b1');
select lives_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date)
  values (%L, 'Avulsa B', 80, '2026-11-20') $$, current_setting('t.hb')), 'B cria avulsa');
reset role;
select set_config('t.obb', (select id::text from public.fin_one_off_bills where name = 'Avulsa B'), true);

-- Outra família não lê nem escreve
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000021b1');
select is((select count(*)::int from public.fin_one_off_bills where household_id = current_setting('t.ha')::uuid), 0, 'B não vê avulsas de A');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date)
  values (%L, 'Invasão', 1, '2026-11-01') $$, current_setting('t.ha')), '42501', null, 'B não cria avulsa na família de A');
update public.fin_one_off_bills set name = 'Hackeado' where household_id = current_setting('t.ha')::uuid;
delete from public.fin_one_off_bills where household_id = current_setting('t.ha')::uuid;
select pg_temp.as_user('00000000-0000-0000-0000-0000000021a1');
select is((select count(*)::int from public.fin_one_off_bills where household_id = current_setting('t.hb')::uuid), 0, 'A não vê avulsas de B');
reset role;
select is((select name from public.fin_one_off_bills where id = current_setting('t.ob1')::uuid), 'IPTU 2026', 'B não altera avulsa de A');
select is((select count(*)::int from public.fin_one_off_bills where household_id = current_setting('t.ha')::uuid), 1, 'B não apaga avulsa de A');

-- Checks
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000021a1');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date)
  values (%L, 'x', 0, '2026-11-01') $$, current_setting('t.ha')), '23514', null, 'valor zero é recusado');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date)
  values (%L, 'x', 10000000.01, '2026-11-01') $$, current_setting('t.ha')), '23514', null, 'valor acima do teto é recusado');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date)
  values (%L, '', 10, '2026-11-01') $$, current_setting('t.ha')), '23514', null, 'nome vazio é recusado');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date)
  values (%L, %L, 10, '2026-11-01') $$, current_setting('t.ha'), repeat('a', 61)), '23514', null, 'nome com 61 caracteres é recusado');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, transaction_id)
  values (%L, 'x', 10, '2026-11-01', %L) $$, current_setting('t.ha'), current_setting('t.tx2')),
  '23514', null, 'lançamento ligado sem paid_on é recusado');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, paid_auto)
  values (%L, 'x', 10, '2026-11-01', true) $$, current_setting('t.ha')),
  '23514', null, 'baixa automática sem paid_on é recusada');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, paid_on, transaction_id)
  values (%L, 'x', 10, '2026-11-01', '2026-11-10', %L) $$, current_setting('t.ha'), current_setting('t.tx1')),
  '23505', null, 'um lançamento não paga duas avulsas');
select lives_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, paid_on, transaction_id)
  values (%L, 'Conserto', 120, '2026-11-11', '2026-11-11', %L) $$, current_setting('t.ha'), current_setting('t.tx2')),
  'outro lançamento paga outra avulsa');
select set_config('t.ob2', (select id::text from public.fin_one_off_bills where name = 'Conserto'), true);

-- FKs de outra família são recusadas
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, category_id)
  values (%L, 'x', 10, '2026-11-01', %L) $$, current_setting('t.ha'), current_setting('t.cat_b')),
  '23503', null, 'A não usa categoria de B');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, account_id)
  values (%L, 'x', 10, '2026-11-01', %L) $$, current_setting('t.ha'), current_setting('t.acc_b')),
  '23503', null, 'A não usa conta de B');
select throws_ok(format($$ insert into public.fin_one_off_bills (household_id, name, amount, due_date, paid_on, transaction_id)
  values (%L, 'x', 10, '2026-11-01', '2026-11-10', %L) $$, current_setting('t.ha'), current_setting('t.txb')),
  '23503', null, 'A não paga avulsa com lançamento de B');

-- Documentos
select lives_ok(format($$ insert into public.fin_documents (household_id, kind, file_path, file_mime, file_size, one_off_bill_id)
  values (%L, 'boleto', 'a/docs/1.pdf', 'application/pdf', 100, %L) $$, current_setting('t.ha'), current_setting('t.ob1')),
  'documento de A liga à avulsa de A');
select throws_ok(format($$ insert into public.fin_documents (household_id, kind, file_path, file_mime, file_size, bill_id, bill_month, one_off_bill_id)
  values (%L, 'boleto', 'a/docs/2.pdf', 'application/pdf', 100, %L, '2026-11', %L) $$,
  current_setting('t.ha'), current_setting('t.bill_a'), current_setting('t.ob1')),
  '23514', null, 'documento não aponta para fixa e avulsa ao mesmo tempo');
select throws_ok(format($$ insert into public.fin_documents (household_id, kind, file_path, file_mime, file_size, one_off_bill_id)
  values (%L, 'boleto', 'a/docs/3.pdf', 'application/pdf', 100, %L) $$, current_setting('t.ha'), current_setting('t.obb')),
  '23503', null, 'documento de A não liga à avulsa de B');

-- Recusas do cruzamento avulsa x lançamento
select lives_ok(format($$ insert into public.fin_one_off_baixa_dismissals (household_id, one_off_bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.ha'), current_setting('t.ob2'), current_setting('t.tx1')),
  'A recusa par avulsa x lançamento');
select throws_ok(format($$ insert into public.fin_one_off_baixa_dismissals (household_id, one_off_bill_id, transaction_id, reason)
  values (%L, %L, %L, 'desfeita') $$, current_setting('t.ha'), current_setting('t.ob2'), current_setting('t.tx1')),
  '23505', null, 'recusa repetida do mesmo par é recusada');
select throws_ok(format($$ insert into public.fin_one_off_baixa_dismissals (household_id, one_off_bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.ha'), current_setting('t.ob2'), current_setting('t.txb')),
  '23503', null, 'A não recusa par com lançamento de B');
select pg_temp.as_user('00000000-0000-0000-0000-0000000021b1');
select is((select count(*)::int from public.fin_one_off_baixa_dismissals), 0, 'B não vê recusas de A');
select throws_ok(format($$ insert into public.fin_one_off_baixa_dismissals (household_id, one_off_bill_id, transaction_id, reason)
  values (%L, %L, %L, 'nao_e') $$, current_setting('t.ha'), current_setting('t.ob2'), current_setting('t.tx1')),
  '42501', null, 'B não cria recusa na família de A');

-- Apagar lançamento/avulsa: vínculos viram nulos, recusas caem junto
select pg_temp.as_user('00000000-0000-0000-0000-0000000021a1');
delete from public.fin_transactions where id = current_setting('t.tx1')::uuid;
select is((select transaction_id from public.fin_one_off_bills where id = current_setting('t.ob1')::uuid), null,
  'lançamento apagado: avulsa perde o vínculo e continua paga');
delete from public.fin_one_off_bills where id = current_setting('t.ob1')::uuid;
select is((select count(*)::int from public.fin_documents where file_path = 'a/docs/1.pdf' and one_off_bill_id is null), 1,
  'avulsa apagada: documento fica, sem vínculo');
delete from public.fin_one_off_bills where id = current_setting('t.ob2')::uuid;
reset role;
select is((select count(*)::int from public.fin_one_off_baixa_dismissals), 0, 'avulsa apagada: recusas caem junto');

select * from finish();
rollback;
