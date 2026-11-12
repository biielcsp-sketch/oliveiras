-- Contador de leituras de arquivo da Oli (oli_file_reads): contagem por família
-- (colega da mesma família vê; outra família não lê nem insere), sem UPDATE/DELETE,
-- created_at/created_by não forjáveis (grant só em household_id), anon e RLS ligado.
begin;
select plan(27);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'da@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'db@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'dc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A: Ana (d1) + Caio (d3). Família B: Bruno (d2).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.code_a', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select public.join_household(current_setting('t.code_a'), 'Caio');
reset role;

-- estrutura
select is((select relrowsecurity from pg_class where oid = 'public.oli_file_reads'::regclass), true, 'oli_file_reads tem RLS ligado');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'oli_file_reads'
  and roles = '{authenticated}'), 2, '2 políticas, todas só para authenticated');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'oli_file_reads'
  and cmd in ('UPDATE','DELETE','ALL')), 0, 'não existe política de update/delete');
select ok(not has_table_privilege('authenticated', 'public.oli_file_reads', 'update'), 'authenticated não tem grant de update');
select ok(not has_table_privilege('authenticated', 'public.oli_file_reads', 'delete'), 'authenticated não tem grant de delete');
select ok(not has_column_privilege('authenticated', 'public.oli_file_reads', 'created_at', 'insert'), 'authenticated não insere created_at');
select ok(not has_column_privilege('authenticated', 'public.oli_file_reads', 'created_by', 'insert'), 'authenticated não insere created_by');

-- Ana: insere e lê
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok(format($$ insert into public.oli_file_reads (household_id) values (%L) $$,
  current_setting('t.ha')), 'Ana registra uma leitura na própria família');
select is((select count(*)::int from public.oli_file_reads), 1, 'Ana lê o registro');
select is((select created_by from public.oli_file_reads), '00000000-0000-0000-0000-0000000000d1'::uuid, 'created_by vem de auth.uid()');
select is((select created_at from public.oli_file_reads), now(), 'created_at vem do default now()');
select throws_ok(format($$ insert into public.oli_file_reads (household_id, created_at) values (%L, now() - interval '2 days') $$,
  current_setting('t.ha')), '42501', null, 'created_at no passado não pode ser forjado');
select throws_ok(format($$ insert into public.oli_file_reads (household_id, created_by) values (%L, %L) $$,
  current_setting('t.ha'), '00000000-0000-0000-0000-0000000000d3'), '42501', null, 'created_by não pode ser forjado');

-- Caio: mesma família, contagem é da família
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select is((select count(*)::int from public.oli_file_reads), 1, 'Caio vê a leitura de Ana (contagem por família)');
select lives_ok(format($$ insert into public.oli_file_reads (household_id) values (%L) $$,
  current_setting('t.ha')), 'Caio registra uma leitura');
select is((select count(*)::int from public.oli_file_reads), 2, 'família A tem 2 leituras');

-- Bruno: outra família
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.oli_file_reads), 0, 'Bruno (outra família) não lê nada');
select throws_ok(format($$ insert into public.oli_file_reads (household_id) values (%L) $$,
  current_setting('t.ha')), '42501', null, 'Bruno não insere na família de A');
select lives_ok(format($$ insert into public.oli_file_reads (household_id) values (%L) $$,
  current_setting('t.hb')), 'Bruno registra na própria família');
select is((select count(*)::int from public.oli_file_reads), 1, 'Bruno lê só a da própria família');

-- Ana: não vê a de B; não altera nem apaga
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.oli_file_reads), 2, 'Ana não vê a leitura da família B');
select throws_ok($$ update public.oli_file_reads set created_at = now() - interval '2 days' $$, '42501', null, 'update negado');
select throws_ok($$ delete from public.oli_file_reads $$, '42501', null, 'delete negado (não dá para zerar o limite)');
-- contagem do dia em São Paulo (mesma consulta que o front fará)
select is((select count(*)::int from public.oli_file_reads
  where household_id = current_setting('t.ha')::uuid
    and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
  2, 'contagem do dia (São Paulo) da família A = 2');
reset role;
select is((select count(*)::int from public.oli_file_reads), 3, 'nenhum registro foi apagado');

-- anon
set local role anon;
select throws_ok($$ select count(*) from public.oli_file_reads $$, '42501', null, 'anon não lê a tabela');
select throws_ok(format($$ insert into public.oli_file_reads (household_id) values (%L) $$,
  current_setting('t.ha')), '42501', null, 'anon não insere');
reset role;

select * from finish();
rollback;
