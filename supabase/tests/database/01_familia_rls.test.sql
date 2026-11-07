-- Isolamento entre famílias: households, household_users, members e RPCs.
-- Independente de dados já existentes no banco (filtra pela família criada aqui).
begin;
select plan(17);

-- Usuários de teste: A cria a família, B entra pelo código, C é de fora.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- anon não executa as RPCs
set local role anon;
select throws_ok($$ select public.create_household('X', 'Y') $$, '42501', null, 'anon não cria família');
reset role;

-- A cria a família
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select isnt(set_config('t.hid', public.create_household('Família A', 'Ana')::text, true), '', 'A cria família');
select throws_ok($$ select public.create_household('Outra', 'Ana') $$, 'P0001', 'usuário já pertence a uma família', 'A não cria segunda família');
select is((select count(*)::int from public.households), 1, 'A vê a própria família');
select is((select count(*)::int from public.members), 1, 'A vê o próprio membro');

-- A adiciona um dependente
select lives_ok(
  $$ insert into public.members (household_id, name, relation)
     values (current_setting('t.hid')::uuid, 'Filho', 'filho') $$,
  'A adiciona dependente');

-- C (de fora) não vê nada e não consegue escrever na família de A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.households), 0, 'C não vê famílias alheias');
select is((select count(*)::int from public.members), 0, 'C não vê membros alheios');
select is((select count(*)::int from public.household_users), 0, 'C não vê vínculos alheios');

reset role;
select set_config('t.code', (select invite_code from public.households where id = current_setting('t.hid')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');

select throws_ok(
  format($$ insert into public.members (household_id, name) values (%L, 'Intruso') $$, current_setting('t.hid')),
  '42501', null, 'C não insere membro na família de A');

update public.households set name = 'Hackeado' where id = current_setting('t.hid')::uuid;
delete from public.members where household_id = current_setting('t.hid')::uuid;
reset role;
select is((select name from public.households where id = current_setting('t.hid')::uuid), 'Família A', 'C não renomeia família de A');
select is((select count(*)::int from public.members where household_id = current_setting('t.hid')::uuid), 2, 'C não apaga membros de A');

-- Código errado é recusado; código certo permite B entrar
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.join_household('ZZZZZZZZ', 'Bia') $$, 'P0001', 'código inválido', 'código inválido é recusado');
select lives_ok(format($$ select public.join_household(%L, 'Bia') $$, lower(current_setting('t.code'))), 'B entra com o código');
select is((select count(*)::int from public.members), 3, 'B vê os membros da família');

-- B não remove membros com login (só dependentes)
delete from public.members where user_id is not null;
reset role;
select is((select count(*)::int from public.members where user_id is not null and household_id = current_setting('t.hid')::uuid), 2, 'membros com login não são apagados');

-- B não altera household_users (sem política de escrita)
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ insert into public.household_users (household_id, user_id) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000c') $$,
  '42501', null, 'ninguém insere vínculo direto na tabela');

select * from finish();
rollback;
