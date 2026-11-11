-- Regressão: excluir uma conta fixa (fin_bills) como membro autenticado.
-- Esperado: a conta, os pagamentos (cascade) e as dispensas de baixa (cascade)
-- somem; o documento fica com bill_id nulo (set null) e continua existindo; o
-- lançamento do extrato continua. Membro de outra família não apaga nada.
begin;
select plan(14);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'ba@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'bb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;

-- Dados preparados como dono (sem RLS); o delete é que roda como authenticated.
insert into public.fin_accounts (household_id, name, kind)
  values (current_setting('t.ha')::uuid, 'Conta A', 'corrente');
select set_config('t.acc', (select id::text from public.fin_accounts), true);
insert into public.fin_bills (household_id, name, amount, due_day)
  values (current_setting('t.ha')::uuid, 'Luz', 200, 10);
select set_config('t.bill', (select id::text from public.fin_bills), true);
insert into public.fin_transactions (household_id, account_id, date, description, amount)
  values (current_setting('t.ha')::uuid, current_setting('t.acc')::uuid, '2026-11-10', 'Pgto luz', -200);
select set_config('t.tx', (select id::text from public.fin_transactions), true);
insert into public.fin_bill_payments (household_id, bill_id, month, paid_on, amount, transaction_id)
  values (current_setting('t.ha')::uuid, current_setting('t.bill')::uuid, '2026-11', '2026-11-10', 200, current_setting('t.tx')::uuid);
insert into public.fin_documents (household_id, kind, status, file_path, file_mime, file_size, bill_id, bill_month)
  values (current_setting('t.ha')::uuid, 'boleto', 'confirmado',
    current_setting('t.ha') || '/docs/11111111-1111-1111-1111-111111111111.pdf', 'application/pdf', 1000,
    current_setting('t.bill')::uuid, '2026-11');
select set_config('t.doc', (select id::text from public.fin_documents), true);
insert into public.fin_baixa_dismissals (household_id, bill_id, transaction_id, reason)
  values (current_setting('t.ha')::uuid, current_setting('t.bill')::uuid, current_setting('t.tx')::uuid, 'nao_e');

select is((select count(*)::int from public.fin_bill_payments), 1, 'preparo: 1 pagamento');
select is((select bill_id::text from public.fin_documents), current_setting('t.bill'), 'preparo: documento ligado à conta');

-- outra família: não apaga -------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select is_empty(format($$ delete from public.fin_bills where id = %L returning 1 $$, current_setting('t.bill')), 'B não apaga conta de A (0 linhas)');
reset role;
select is((select count(*)::int from public.fin_bills), 1, 'conta de A continua após tentativa de B');

-- membro: apaga ------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok(format($$ delete from public.fin_bills where id = %L $$, current_setting('t.bill')), 'A apaga a conta fixa');
select is((select count(*)::int from public.fin_bills), 0, 'a conta sumiu');
select is((select count(*)::int from public.fin_bill_payments), 0, 'cascade: pagamentos sumiram');
select is((select count(*)::int from public.fin_baixa_dismissals), 0, 'cascade: dispensas sumiram');
select is((select count(*)::int from public.fin_documents where id = current_setting('t.doc')::uuid), 1, 'o documento continua');
select is((select bill_id is null from public.fin_documents where id = current_setting('t.doc')::uuid), true, 'documento ficou com bill_id nulo');
select is((select bill_month || '/' || status || '/' || household_id::text from public.fin_documents where id = current_setting('t.doc')::uuid),
  '2026-11/confirmado/' || current_setting('t.ha'), 'documento mantém mês, status e família');
select is((select count(*)::int from public.fin_transactions where id = current_setting('t.tx')::uuid), 1, 'o lançamento do extrato continua');
select is((select count(*)::int from public.fin_accounts), 1, 'a conta bancária continua');

-- anon não apaga -----------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$ delete from public.fin_bills $$, '42501', null, 'anon não apaga fin_bills');
reset role;

select * from finish();
rollback;
