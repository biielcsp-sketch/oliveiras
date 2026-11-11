-- Histórico da Oli (oli_messages): conversa privada por pessoa (outra família e
-- colega da mesma família não leem/escrevem/apagam), sem UPDATE, checks,
-- teto de 300 por pessoa, anon e RLS ligado.
begin;
select plan(30);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'ca@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'cb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'cc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A: Ana (c1) + Caio (c3). Família B: Bruno (c2).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.code_a', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.join_household(current_setting('t.code_a'), 'Caio');
reset role;

-- estrutura
select is((select relrowsecurity from pg_class where oid = 'public.oli_messages'::regclass), true, 'oli_messages tem RLS ligado');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'oli_messages'
  and roles = '{authenticated}'), 3, '3 políticas, todas só para authenticated');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'oli_messages'
  and cmd in ('UPDATE','ALL')), 0, 'não existe política de update');
select ok(not has_table_privilege('authenticated', 'public.oli_messages', 'update'), 'authenticated não tem grant de update');
select ok(not has_function_privilege('authenticated', 'public.oli_messages_trim()', 'execute'),
  'authenticated não executa a função do trigger diretamente');

-- Ana (própria pessoa): insere e lê
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok(format($$ insert into public.oli_messages (household_id, role, content) values (%L, 'user', 'oi da Ana') $$,
  current_setting('t.ha')), 'Ana insere a própria mensagem');
select is((select count(*)::int from public.oli_messages), 1, 'Ana lê a própria mensagem');
select throws_ok(format($$ insert into public.oli_messages (household_id, user_id, role, content) values (%L, %L, 'user', 'como Caio') $$,
  current_setting('t.ha'), '00000000-0000-0000-0000-0000000000c3'), '42501', null, 'Ana não insere com user_id do colega');

-- Caio: mesma família, outra pessoa
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select is((select count(*)::int from public.oli_messages), 0, 'Caio não lê as mensagens de Ana (mesma família)');
select lives_ok(format($$ insert into public.oli_messages (household_id, role, content) values (%L, 'user', 'oi do Caio') $$,
  current_setting('t.ha')), 'Caio insere a própria mensagem');
select is((select array_agg(content) from public.oli_messages), array['oi do Caio'], 'Caio lê só a própria');
delete from public.oli_messages where content = 'oi da Ana';
reset role;
select is((select count(*)::int from public.oli_messages where content = 'oi da Ana'), 1, 'Caio não apaga a mensagem de Ana');
set local role authenticated;

-- Bruno: outra família
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.oli_messages), 0, 'Bruno (outra família) não lê nada');
select throws_ok(format($$ insert into public.oli_messages (household_id, role, content) values (%L, 'user', 'invasão') $$,
  current_setting('t.ha')), '42501', null, 'Bruno não insere na família de A');
select throws_ok(format($$ insert into public.oli_messages (household_id, user_id, role, content) values (%L, %L, 'user', 'invasão') $$,
  current_setting('t.ha'), '00000000-0000-0000-0000-0000000000c1'), '42501', null, 'Bruno não insere como Ana na família de A');
delete from public.oli_messages;
reset role;
select is((select count(*)::int from public.oli_messages), 2, 'Bruno não apaga mensagens de outra família');
set local role authenticated;

-- update negado (nem a dona altera)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ update public.oli_messages set content = 'editada' $$, '42501', null, 'Ana não edita mensagem (sem update)');

-- checks
select throws_ok(format($$ insert into public.oli_messages (household_id, role, content) values (%L, 'admin', 'x') $$,
  current_setting('t.ha')), '23514', null, 'role inválido é rejeitado');
select throws_ok(format($$ insert into public.oli_messages (household_id, role, content) values (%L, 'user', '') $$,
  current_setting('t.ha')), '23514', null, 'content vazio é rejeitado');
select throws_ok(format($$ insert into public.oli_messages (household_id, role, content) values (%L, 'model', repeat('x', 4001)) $$,
  current_setting('t.ha')), '23514', null, 'content com mais de 4000 caracteres é rejeitado');
select lives_ok(format($$ insert into public.oli_messages (household_id, role, content) values (%L, 'model', repeat('x', 4000)) $$,
  current_setting('t.ha')), 'content com 4000 caracteres é aceito');

-- Ana apaga as suas
delete from public.oli_messages;
select is((select count(*)::int from public.oli_messages), 0, 'Ana apaga as próprias mensagens');
reset role;
select is((select count(*)::int from public.oli_messages where user_id = '00000000-0000-0000-0000-0000000000c3'), 1,
  'apagar as de Ana não toca nas de Caio');
set local role authenticated;

-- teto de 300: insere 305 de uma vez (m1 mais antiga ... m305 mais nova)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into public.oli_messages (household_id, role, content, created_at)
  select current_setting('t.ha')::uuid, 'user', 'm' || g, now() - ((1000 - g) * interval '1 minute')
  from generate_series(1, 305) g;
select is((select count(*)::int from public.oli_messages), 300, 'teto: Ana fica com 300 mensagens');
select is((select count(*)::int from public.oli_messages where content in ('m1','m2','m3','m4','m5')), 0, 'teto: as 5 mais antigas foram apagadas');
select ok((select bool_and(true) from public.oli_messages where content in ('m6','m305')) and
  (select count(*) = 2 from public.oli_messages where content in ('m6','m305')), 'teto: a 6a e a mais nova continuam');
insert into public.oli_messages (household_id, role, content) values (current_setting('t.ha')::uuid, 'model', 'nova');
select is((select count(*)::int from public.oli_messages where content in ('m6','nova')), 1, 'teto: nova mensagem empurra a mais antiga (m6) para fora');
reset role;
select is((select count(*)::int from public.oli_messages where user_id = '00000000-0000-0000-0000-0000000000c3'), 1,
  'teto de Ana não afeta as mensagens de Caio');

-- anon
set local role anon;
select throws_ok($$ select count(*) from public.oli_messages $$, '42501', null, 'anon não lê a tabela');
select throws_ok(format($$ insert into public.oli_messages (household_id, user_id, role, content) values (%L, %L, 'user', 'x') $$,
  current_setting('t.ha'), '00000000-0000-0000-0000-0000000000c1'), '42501', null, 'anon não insere');
reset role;

select * from finish();
rollback;
