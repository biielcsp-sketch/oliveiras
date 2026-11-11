-- Avisos push: assinaturas por pessoa (RLS), log inacessível, checks de reminder_times.
begin;
select plan(45);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'pa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'pb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b3', 'pc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.n(q text) returns int language plpgsql as $$
declare c int; begin execute q; get diagnostics c = row_count; return c; end $$;

-- Família A: Ana (b1) + cônjuge Caio (b3). Família B: Bruno (b2).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.code_a', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select public.join_household(current_setting('t.code_a'), 'Caio');
reset role;
select set_config('t.ma', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000b1'), true);
set local role authenticated;

-- Ana cria e lê a sua -----------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth, user_agent)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://push.example/a', 'k', 'a', 'UA') $$, current_setting('t.ha')), 'Ana cria a sua assinatura');
select is((select count(*)::int from public.push_subscriptions), 1, 'Ana lê a sua');
select lives_ok(format($$ update public.push_subscriptions set last_seen_at = now() where endpoint = 'https://push.example/a' $$), 'Ana altera a sua');

-- Caio (mesma família) cria a dele e não vê a de Ana ----------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from public.push_subscriptions), 0, 'cônjuge não vê a assinatura de Ana');
select lives_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b3', 'https://push.example/c', 'k', 'a') $$, current_setting('t.ha')), 'Caio cria a sua');
select is((select count(*)::int from public.push_subscriptions), 1, 'Caio vê só a sua');
select is((select user_id::text from public.push_subscriptions), '00000000-0000-0000-0000-0000000000b3', 'e é a dele');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://push.example/forjada', 'k', 'a') $$, current_setting('t.ha')), '42501', null, 'Caio não insere com user_id de Ana');
select is(pg_temp.n($q$ update public.push_subscriptions set p256dh = 'x' where endpoint = 'https://push.example/a' $q$), 0, 'Caio não altera a de Ana');
select is(pg_temp.n($q$ delete from public.push_subscriptions where endpoint = 'https://push.example/a' $q$), 0, 'Caio não apaga a de Ana');
select throws_ok($$ update public.push_subscriptions set user_id = '00000000-0000-0000-0000-0000000000b1' $$, '42501', null, 'Caio não transfere a sua para Ana');

-- Família B -----------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from public.push_subscriptions), 0, 'B não lê nada');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b2', 'https://push.example/b-em-a', 'k', 'a') $$, current_setting('t.ha')), '42501', null, 'B não insere com household_id de A');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://push.example/b-forja', 'k', 'a') $$, current_setting('t.hb')), '42501', null, 'B não insere com user_id de Ana');
select is(pg_temp.n($q$ update public.push_subscriptions set p256dh = 'x' $q$), 0, 'B não altera nada de A');
select is(pg_temp.n($q$ delete from public.push_subscriptions $q$), 0, 'B não apaga nada de A');
select lives_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b2', 'https://push.example/b', 'k', 'a') $$, current_setting('t.hb')), 'B cria a sua');

-- Checks --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'http://inseguro.example/x', 'k', 'a') $$, current_setting('t.ha')), '23514', null, 'endpoint http:// rejeitado');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://' || repeat('x', 2041), 'k', 'a') $$, current_setting('t.ha')), '23514', null, 'endpoint > 2048 rejeitado');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://push.example/a', 'k', 'a') $$, current_setting('t.ha')), '23505', null, 'endpoint duplicado rejeitado');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://push.example/p', repeat('k', 256), 'a') $$, current_setting('t.ha')), '23514', null, 'p256dh > 255 rejeitado');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://push.example/q', 'k', repeat('a', 256)) $$, current_setting('t.ha')), '23514', null, 'auth > 255 rejeitado');
select throws_ok(format($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth, user_agent)
  values (%L, '00000000-0000-0000-0000-0000000000b1', 'https://push.example/r', 'k', 'a', repeat('u', 301)) $$, current_setting('t.ha')), '23514', null, 'user_agent > 300 rejeitado');
select lives_ok(format($$ delete from public.push_subscriptions where endpoint = 'https://push.example/a' $$), 'Ana apaga a sua');
select is((select count(*)::int from public.push_subscriptions), 0, 'e some');

-- Log: authenticated não lê nem escreve --------------------------------------------
select throws_ok($$ select count(*) from public.push_dispatch_log $$, '42501', null, 'authenticated não lê o log');
select throws_ok($$ insert into public.push_dispatch_log (key) values ('x') $$, '42501', null, 'authenticated não escreve no log');
select throws_ok($$ delete from public.push_dispatch_log $$, '42501', null, 'authenticated não apaga do log');

-- reminder_times (como Ana, dona do medicamento) -----------------------------------
select lives_ok(format($$ insert into public.health_medications (household_id, member_id, name) values (%L, %L, 'Losartana') $$,
  current_setting('t.ha'), current_setting('t.ma')), 'medicamento sem horários (default)');
select is((select reminder_times from public.health_medications), '{}'::text[], 'default é array vazio');
select lives_ok($$ update public.health_medications set reminder_times = array['08:00'] $$, 'um horário 08:00 aceito');
select lives_ok($$ update public.health_medications set reminder_times = array['00:00','23:59','12:30','06:05','18:45','21:00'] $$, '6 horários válidos (00:00..23:59) aceitos');
select lives_ok($$ update public.health_medications set reminder_times = '{}' $$, 'vazio aceito');
select throws_ok($$ update public.health_medications set reminder_times = array['24:00'] $$, '23514', null, '24:00 rejeitado');
select throws_ok($$ update public.health_medications set reminder_times = array['8:00'] $$, '23514', null, '8:00 rejeitado');
select throws_ok($$ update public.health_medications set reminder_times = array['12:60'] $$, '23514', null, '12:60 rejeitado');
select throws_ok($$ update public.health_medications set reminder_times = array['01:00','02:00','03:00','04:00','05:00','06:00','07:00'] $$, '23514', null, '7 horários rejeitado');
select throws_ok($$ update public.health_medications set reminder_times = array[''] $$, '23514', null, 'string vazia no array rejeitada');
select throws_ok($$ update public.health_medications set reminder_times = array['08:00',''] $$, '23514', null, 'string vazia ao lado de horário rejeitada');
select throws_ok($$ update public.health_medications set reminder_times = array['08:00,09:00'] $$, '23514', null, 'dois horários em um item rejeitado');
select throws_ok($$ update public.health_medications set reminder_times = array['08:00', null] $$, '23514', null, 'NULL no array rejeitado');
select throws_ok($$ update public.health_medications set reminder_times = array['08:00 '] $$, '23514', null, 'espaço sobrando rejeitado');

-- anon -------------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.push_subscriptions $$, '42501', null, 'anon não lê assinaturas');
select throws_ok($$ insert into public.push_subscriptions (household_id, user_id, endpoint, p256dh, auth) values (gen_random_uuid(), gen_random_uuid(), 'https://x.example/a', 'k', 'a') $$, '42501', null, 'anon não insere assinatura');
select throws_ok($$ select count(*) from public.push_dispatch_log $$, '42501', null, 'anon não lê o log');

select * from finish();
rollback;
