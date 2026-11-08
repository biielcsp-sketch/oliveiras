-- Memórias da Oli: isolamento por família, member_id da mesma família,
-- busca respeitando RLS, grants de anon, trigger de updated_at e limites.
begin;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'ma@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'mb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.ma', (select id::text from public.members where household_id = current_setting('t.ha')::uuid), true);
select set_config('t.mb', (select id::text from public.members where household_id = current_setting('t.hb')::uuid), true);
set local role authenticated;

-- A: cria, lê, edita
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into public.oli_memories (household_id, member_id, category, content)
  values (%L, %L, 'preferencia', 'Ana prefere café sem açúcar') $$, current_setting('t.ha'), current_setting('t.ma')),
  'A cria memória da própria família');
select set_config('t.mem_a', (select id::text from public.oli_memories where household_id = current_setting('t.ha')::uuid), true);
select is((select count(*)::int from public.oli_memories), 1, 'A lê a própria memória');
select throws_ok(format($$ insert into public.oli_memories (household_id, member_id, content) values (%L, %L, 'mistura') $$,
  current_setting('t.ha'), current_setting('t.mb')), '23503', null, 'A não liga memória a pessoa de B');
select throws_ok(format($$ update public.oli_memories set member_id = %L where id = %L $$,
  current_setting('t.mb'), current_setting('t.mem_a')), '23503', null, 'A não troca member_id para pessoa de B');

-- trigger de updated_at
reset role;
update public.oli_memories set updated_at = '2000-01-01' where id = current_setting('t.mem_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
update public.oli_memories set content = 'Ana prefere café sem açúcar e forte' where id = current_setting('t.mem_a')::uuid;
reset role;
select is((select content from public.oli_memories where id = current_setting('t.mem_a')::uuid),
  'Ana prefere café sem açúcar e forte', 'A edita a própria memória');
select ok((select updated_at > '2000-01-01' from public.oli_memories where id = current_setting('t.mem_a')::uuid),
  'trigger atualiza updated_at');
set local role authenticated;

-- limites de content e category
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok(format($$ insert into public.oli_memories (household_id, content) values (%L, 'ab') $$, current_setting('t.ha')),
  '23514', null, 'content com menos de 3 caracteres é rejeitado');
select throws_ok(format($$ insert into public.oli_memories (household_id, content) values (%L, repeat('x', 501)) $$, current_setting('t.ha')),
  '23514', null, 'content com mais de 500 caracteres é rejeitado');
select lives_ok(format($$ insert into public.oli_memories (household_id, content) values (%L, repeat('x', 500)) $$, current_setting('t.ha')),
  'content com 500 caracteres é aceito');
select throws_ok(format($$ insert into public.oli_memories (household_id, category, content) values (%L, 'segredo', 'teste') $$, current_setting('t.ha')),
  '23514', null, 'category fora da lista é rejeitada');

-- B: não lê, não cria com household de A, não edita, não apaga
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from public.oli_memories where household_id = current_setting('t.ha')::uuid), 0, 'B não lê memórias de A');
select throws_ok(format($$ insert into public.oli_memories (household_id, content) values (%L, 'invasão') $$, current_setting('t.ha')),
  '42501', null, 'B não cria memória na família de A');
update public.oli_memories set content = 'alterado por B' where id = current_setting('t.mem_a')::uuid;
delete from public.oli_memories where id = current_setting('t.mem_a')::uuid;
reset role;
select is((select content from public.oli_memories where id = current_setting('t.mem_a')::uuid),
  'Ana prefere café sem açúcar e forte', 'B não edita nem apaga memória de A');
set local role authenticated;

-- busca: B procura na família de A e não acha; A acha
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select lives_ok(format($$ insert into public.oli_memories (household_id, member_id, content) values (%L, %L, 'Bruno prefere café coado') $$,
  current_setting('t.hb'), current_setting('t.mb')), 'B cria memória da própria família');
select is((select count(*)::int from public.oli_search_memories(current_setting('t.ha')::uuid, 'café')), 0,
  'busca de B na família de A não retorna nada');
select is((select count(*)::int from public.oli_search_memories(current_setting('t.hb')::uuid, 'café')), 1,
  'busca de B retorna só a memória de B');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is((select array_agg(content) from public.oli_search_memories(current_setting('t.ha')::uuid, 'café')),
  array['Ana prefere café sem açúcar e forte'], 'busca de A retorna só a memória de A');

-- A apaga a própria memória
delete from public.oli_memories where id = current_setting('t.mem_a')::uuid;
reset role;
select is((select count(*)::int from public.oli_memories where id = current_setting('t.mem_a')::uuid), 0, 'A apaga a própria memória');

-- apagar pessoa zera member_id e mantém a memória
delete from public.members where id = current_setting('t.mb')::uuid;
select is((select member_id from public.oli_memories where household_id = current_setting('t.hb')::uuid), null,
  'apagar pessoa mantém a memória sem member_id');

-- anon: sem acesso à tabela nem à busca
set local role anon;
select throws_ok($$ select count(*) from public.oli_memories $$, '42501', null, 'anon não lê a tabela');
select throws_ok(format($$ select * from public.oli_search_memories(%L, 'café') $$, current_setting('t.hb')),
  '42501', null, 'anon não executa oli_search_memories');
reset role;
select ok(not has_function_privilege('authenticated', 'public.oli_memories_touch()', 'execute'),
  'authenticated não executa a função de trigger diretamente');

select * from finish();
rollback;
