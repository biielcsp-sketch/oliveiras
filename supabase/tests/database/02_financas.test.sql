-- Finanças: seed, isolamento por família, integridade entre famílias e dedup.
begin;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'fa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'fb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Duas famílias: A e B
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);

-- Seed: categorias e regras padrão
select is((select count(*)::int from public.fin_categories), 24, 'B recebe 24 categorias padrão');
select is((select count(*)::int from public.fin_rules), 5, 'B recebe 5 regras padrão');
select is((select count(*)::int from public.fin_categories where kind = 'transferencia'), 3, '3 categorias de transferência');

-- B cria conta e lançamento
select lives_ok(format($$ insert into public.fin_accounts (household_id, name, kind, opening_balance)
  values (%L, 'Conta B', 'corrente', 100) $$, current_setting('t.hb')), 'B cria conta');
reset role;
select set_config('t.acc_b', (select id::text from public.fin_accounts where household_id = current_setting('t.hb')::uuid), true);
select set_config('t.cat_b', (select id::text from public.fin_categories where household_id = current_setting('t.hb')::uuid and name = 'Mercado'), true);
select set_config('t.mem_b', (select id::text from public.members where household_id = current_setting('t.hb')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select lives_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount, category_id, member_id, external_id, source)
  values (%L, %L, '2026-11-01', 'Mercado', -40.50, %L, %L, 'FIT1', 'ofx') $$,
  current_setting('t.hb'), current_setting('t.acc_b'), current_setting('t.cat_b'), current_setting('t.mem_b')), 'B lança gasto');
select is((select balance from public.fin_account_balances where account_id = current_setting('t.acc_b')::uuid), 59.50::numeric, 'saldo = inicial + lançamentos');

-- Dedup: mesmo external_id na mesma conta é recusado
select throws_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount, external_id)
  values (%L, %L, '2026-11-01', 'Mercado', -40.50, 'FIT1') $$, current_setting('t.hb'), current_setting('t.acc_b')),
  '23505', null, 'importação duplicada é recusada');

-- A não vê nada de B
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.fin_accounts where household_id = current_setting('t.hb')::uuid), 0, 'A não vê contas de B');
select is((select count(*)::int from public.fin_transactions where household_id = current_setting('t.hb')::uuid), 0, 'A não vê lançamentos de B');
select is((select count(*)::int from public.fin_categories where household_id = current_setting('t.hb')::uuid), 0, 'A não vê categorias de B');
select is((select count(*)::int from public.fin_rules where household_id = current_setting('t.hb')::uuid), 0, 'A não vê regras de B');
select is((select count(*)::int from public.fin_account_balances where household_id = current_setting('t.hb')::uuid), 0, 'view de saldos respeita o RLS');

-- A não escreve na família de B
select throws_ok(format($$ insert into public.fin_accounts (household_id, name, kind) values (%L, 'X', 'corrente') $$,
  current_setting('t.hb')), '42501', null, 'A não cria conta na família de B');
update public.fin_transactions set amount = -1 where household_id = current_setting('t.hb')::uuid;
delete from public.fin_accounts where household_id = current_setting('t.hb')::uuid;

-- A não liga lançamento da própria família a conta/categoria/membro de B (FK composta)
select lives_ok(format($$ insert into public.fin_accounts (household_id, name, kind) values (%L, 'Conta A', 'corrente') $$,
  current_setting('t.ha')), 'A cria a própria conta');
select throws_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount)
  values (%L, %L, '2026-11-01', 'x', -1) $$, current_setting('t.ha'), current_setting('t.acc_b')),
  '23503', null, 'A não usa conta de B');
reset role;
select set_config('t.acc_a', (select id::text from public.fin_accounts where household_id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount, category_id)
  values (%L, %L, '2026-11-01', 'x', -1, %L) $$, current_setting('t.ha'), current_setting('t.acc_a'), current_setting('t.cat_b')),
  '23503', null, 'A não usa categoria de B');
select throws_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount, member_id)
  values (%L, %L, '2026-11-01', 'x', -1, %L) $$, current_setting('t.ha'), current_setting('t.acc_a'), current_setting('t.mem_b')),
  '23503', null, 'A não usa membro de B');

reset role;
select is((select amount from public.fin_transactions where account_id = current_setting('t.acc_b')::uuid), -40.50::numeric, 'A não altera lançamento de B');
select is((select count(*)::int from public.fin_accounts where household_id = current_setting('t.hb')::uuid), 1, 'A não apaga conta de B');

-- Apagar categoria mantém o lançamento (categoria vira nula, família intacta)
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
delete from public.fin_categories where id = current_setting('t.cat_b')::uuid;
select is((select category_id from public.fin_transactions where account_id = current_setting('t.acc_b')::uuid), null, 'categoria apagada vira nula');
select is((select household_id::text from public.fin_transactions where account_id = current_setting('t.acc_b')::uuid), current_setting('t.hb'), 'lançamento continua na família');

-- seed_fin_defaults não é chamável pelo app
select throws_ok(format($$ select public.seed_fin_defaults(%L) $$, current_setting('t.ha')), '42501', null, 'app não chama seed direto');

select * from finish();
rollback;
