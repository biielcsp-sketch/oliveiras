-- Agenda (Google Calendar): isolamento por família, FKs compostas, regras do
-- dono da conta Google x cônjuge, checks, trigger de updated_at e grants.
begin;
select plan(36);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'ga@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'gb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'gc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A: Ana (f1) + cônjuge Caio (f3). Família B: Bruno (f2).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.code_a', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select public.join_household(current_setting('t.code_a'), 'Caio');
reset role;
select set_config('t.ma', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000f1'), true);
select set_config('t.mc', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000f3'), true);
select set_config('t.mb', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000f2'), true);
set local role authenticated;

-- A: conecta a própria conta, cria agenda e evento, lê tudo
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
  values (%L, %L, 'sub-ana', 'ana@gmail.test', 'v1.iv.cipher.tag', 'calendar') $$, current_setting('t.ha'), current_setting('t.ma')),
  'A conecta a própria conta Google');
select set_config('t.acc_a', (select id::text from public.google_accounts where google_sub = 'sub-ana'), true);
select lives_ok(format($$ insert into public.cal_calendars (household_id, account_ref, google_calendar_id, summary, color, access_role)
  values (%L, %L, 'ana@gmail.test', 'Ana', '#1a2B3c', 'owner') $$, current_setting('t.ha'), current_setting('t.acc_a')),
  'A cria agenda da própria conta');
select set_config('t.cal_a', (select id::text from public.cal_calendars where account_ref = current_setting('t.acc_a')::uuid), true);
select lives_ok(format($$ insert into public.cal_events (household_id, calendar_ref, google_event_id, title, starts_at, ends_at)
  values (%L, %L, 'ev1', 'Culto', '2026-11-08 19:00-03', '2026-11-08 21:00-03') $$, current_setting('t.ha'), current_setting('t.cal_a')),
  'A cria evento na própria agenda');
select set_config('t.ev_a', (select id::text from public.cal_events where google_event_id = 'ev1'), true);
select is((select count(*)::int from public.google_accounts), 1, 'A lê a própria conta Google');
select is((select count(*)::int from public.cal_calendars), 1, 'A lê a própria agenda');
select is((select count(*)::int from public.cal_events), 1, 'A lê o próprio evento');
select throws_ok(format($$ insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
  values (%L, %L, 'sub-x', 'x@gmail.test', 'c', 'calendar') $$, current_setting('t.ha'), current_setting('t.mb')),
  '42501', null, 'A não conecta conta com member_id de B');
select throws_ok(format($$ insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
  values (%L, %L, 'sub-ana', 'ana2@gmail.test', 'c', 'calendar') $$, current_setting('t.ha'), current_setting('t.ma')),
  '23505', null, 'mesma conta Google não entra duas vezes na família');

-- checks
select throws_ok(format($$ insert into public.cal_events (household_id, calendar_ref, google_event_id, starts_at, ends_at)
  values (%L, %L, 'ev-inv', '2026-11-08 10:00-03', '2026-11-08 09:00-03') $$, current_setting('t.ha'), current_setting('t.cal_a')),
  '23514', null, 'evento com ends_at < starts_at é rejeitado');
select throws_ok(format($$ insert into public.cal_events (household_id, calendar_ref, google_event_id, status, starts_at, ends_at)
  values (%L, %L, 'ev-st', 'apagado', now(), now()) $$, current_setting('t.ha'), current_setting('t.cal_a')),
  '23514', null, 'status de evento fora da lista é rejeitado');
select throws_ok(format($$ insert into public.cal_calendars (household_id, account_ref, google_calendar_id, summary, color)
  values (%L, %L, 'c2', 'X', 'red') $$, current_setting('t.ha'), current_setting('t.acc_a')),
  '23514', null, 'cor fora do formato #rrggbb é rejeitada');
select throws_ok(format($$ update public.google_accounts set status = 'quebrado' where id = %L $$, current_setting('t.acc_a')),
  '23514', null, 'status de conta fora da lista é rejeitado');
select throws_ok(format($$ update public.google_accounts set token_ciphertext = repeat('x', 4097) where id = %L $$, current_setting('t.acc_a')),
  '23514', null, 'token_ciphertext acima de 4096 é rejeitado');

-- trigger de updated_at (conta e evento)
reset role;
update public.google_accounts set updated_at = '2000-01-01' where id = current_setting('t.acc_a')::uuid;
update public.cal_events set updated_at = '2000-01-01' where id = current_setting('t.ev_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
update public.cal_events set title = 'Culto de domingo' where id = current_setting('t.ev_a')::uuid;
-- cônjuge atualiza a conta Google de Ana (sincronização)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.google_accounts where id = current_setting('t.acc_a')::uuid), 1,
  'cônjuge lê a conta Google do outro');
select lives_ok(format($$ update public.google_accounts set last_sync_at = '2026-11-08 12:00-03', status = 'ok' where id = %L $$,
  current_setting('t.acc_a')), 'cônjuge atualiza a conta Google do outro');
reset role;
select is((select last_sync_at from public.google_accounts where id = current_setting('t.acc_a')::uuid),
  '2026-11-08 12:00-03'::timestamptz, 'atualização do cônjuge foi gravada');
select ok((select updated_at > '2000-01-01' from public.google_accounts where id = current_setting('t.acc_a')::uuid),
  'trigger atualiza updated_at da conta');
select ok((select updated_at > '2000-01-01' from public.cal_events where id = current_setting('t.ev_a')::uuid),
  'trigger atualiza updated_at do evento');
set local role authenticated;

-- cônjuge: não conecta conta em nome do outro, não troca o dono, não apaga
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select throws_ok(format($$ insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
  values (%L, %L, 'sub-ana-2', 'ana2@gmail.test', 'c', 'calendar') $$, current_setting('t.ha'), current_setting('t.ma')),
  '42501', null, 'cônjuge não conecta conta com member_id do outro');
select throws_ok(format($$ update public.google_accounts set member_id = %L where id = %L $$,
  current_setting('t.mc'), current_setting('t.acc_a')), '42501', null, 'cônjuge não troca o dono da conta para si');
delete from public.google_accounts where id = current_setting('t.acc_a')::uuid;
reset role;
select is((select count(*)::int from public.google_accounts where id = current_setting('t.acc_a')::uuid), 1,
  'cônjuge não apaga a conta Google do outro');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select lives_ok(format($$ insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
  values (%L, %L, 'sub-caio', 'caio@gmail.test', 'c', 'calendar') $$, current_setting('t.ha'), current_setting('t.mc')),
  'cônjuge conecta a própria conta');

-- B: não lê, não escreve, não aponta para conta/agenda de A
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is((select count(*)::int from public.google_accounts), 0, 'B não lê contas Google de A');
select is((select count(*)::int from public.cal_calendars), 0, 'B não lê agendas de A');
select is((select count(*)::int from public.cal_events), 0, 'B não lê eventos de A');
select throws_ok(format($$ insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
  values (%L, %L, 'sub-b', 'b@gmail.test', 'c', 'calendar') $$, current_setting('t.ha'), current_setting('t.mb')),
  '42501', null, 'B não cria conta na família de A');
select throws_ok(format($$ insert into public.cal_calendars (household_id, account_ref, google_calendar_id, summary)
  values (%L, %L, 'b-cal', 'B') $$, current_setting('t.ha'), current_setting('t.acc_a')),
  '42501', null, 'B não cria agenda na família de A');
select throws_ok(format($$ insert into public.cal_calendars (household_id, account_ref, google_calendar_id, summary)
  values (%L, %L, 'b-cal', 'B') $$, current_setting('t.hb'), current_setting('t.acc_a')),
  '23503', null, 'B não cria agenda própria apontando para conta de A (FK composta)');
select throws_ok(format($$ insert into public.cal_events (household_id, calendar_ref, google_event_id, starts_at, ends_at)
  values (%L, %L, 'b-ev', now(), now()) $$, current_setting('t.hb'), current_setting('t.cal_a')),
  '23503', null, 'B não cria evento próprio apontando para agenda de A (FK composta)');
update public.google_accounts set status = 'erro' where id = current_setting('t.acc_a')::uuid;
update public.cal_calendars set summary = 'invadido' where id = current_setting('t.cal_a')::uuid;
update public.cal_events set title = 'invadido' where id = current_setting('t.ev_a')::uuid;
delete from public.cal_events where id = current_setting('t.ev_a')::uuid;
delete from public.cal_calendars where id = current_setting('t.cal_a')::uuid;
delete from public.google_accounts where id = current_setting('t.acc_a')::uuid;
reset role;
select is((select status || '|' || (select summary from public.cal_calendars where id = current_setting('t.cal_a')::uuid)
  || '|' || (select title from public.cal_events where id = current_setting('t.ev_a')::uuid)
  from public.google_accounts where id = current_setting('t.acc_a')::uuid),
  'ok|Ana|Culto de domingo', 'B não altera nem apaga conta, agenda ou evento de A');

-- A desconecta a própria conta: agendas e eventos vão junto (cascade)
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
delete from public.google_accounts where id = current_setting('t.acc_a')::uuid;
reset role;
select is((select count(*)::int from public.google_accounts where id = current_setting('t.acc_a')::uuid), 0,
  'dono apaga a própria conta Google');
select is((select count(*)::int from public.cal_events where id = current_setting('t.ev_a')::uuid)
  + (select count(*)::int from public.cal_calendars where id = current_setting('t.cal_a')::uuid), 0,
  'apagar a conta leva agendas e eventos');

-- anon: sem acesso
set local role anon;
select throws_ok($$ select count(*) from public.google_accounts $$, '42501', null, 'anon não lê google_accounts');
select throws_ok($$ select count(*) from public.cal_calendars $$, '42501', null, 'anon não lê cal_calendars');
select throws_ok($$ select count(*) from public.cal_events $$, '42501', null, 'anon não lê cal_events');
reset role;
select ok(not has_function_privilege('authenticated', 'public.agenda_touch()', 'execute'),
  'authenticated não executa a função de trigger diretamente');

select * from finish();
rollback;
