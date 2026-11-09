-- Saúde: isolamento por família (carteirinhas, consultas, exames), FKs compostas,
-- checks, trigger de updated_at, grants e políticas do bucket privado `saude`.
begin;
select plan(63);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'sa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'sb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'sc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A: Ana (a1) + cônjuge Caio (a3). Família B: Bruno (a2).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.code_a', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select public.join_household(current_setting('t.code_a'), 'Caio');
reset role;
select set_config('t.ma', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000a1'), true);
select set_config('t.mc', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000a3'), true);
select set_config('t.mb', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000a2'), true);
set local role authenticated;

-- Caminhos do storage
select set_config('t.pa_card', current_setting('t.ha') || '/cards/11111111-1111-1111-1111-111111111111.pdf', true);
select set_config('t.pa_exam', current_setting('t.ha') || '/exams/22222222-2222-2222-2222-222222222222.jpg', true);
select set_config('t.pb_card', current_setting('t.hb') || '/cards/33333333-3333-3333-3333-333333333333.pdf', true);

-- A: cria, lê (cônjuge também lê: dados compartilhados) ------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$ insert into public.health_insurance_cards (household_id, member_id, operator, file_path, file_mime, file_size)
  values (%L, %L, 'Operadora X', %L, 'application/pdf', 1000) $$, current_setting('t.ha'), current_setting('t.ma'), current_setting('t.pa_card')),
  'A cria carteirinha');
select set_config('t.card_a', (select id::text from public.health_insurance_cards limit 1), true);
select lives_ok(format($$ insert into public.health_appointments (household_id, member_id, specialty, starts_at)
  values (%L, %L, 'Cardiologia', '2026-12-01 10:00-03') $$, current_setting('t.ha'), current_setting('t.ma')),
  'A cria consulta (defaults kind/status)');
select set_config('t.ap_a', (select id::text from public.health_appointments limit 1), true);
select lives_ok(format($$ insert into public.health_exams (household_id, member_id, name) values (%L, %L, 'Hemograma') $$,
  current_setting('t.ha'), current_setting('t.ma')), 'A cria exame sem arquivo');
select set_config('t.ex_a', (select id::text from public.health_exams limit 1), true);
select is((select kind || '/' || status from public.health_appointments), 'consulta/agendada', 'defaults de consulta');
select is((select count(*)::int from public.health_insurance_cards), 1, 'A lê carteirinha');
select is((select count(*)::int from public.health_appointments), 1, 'A lê consulta');
select is((select count(*)::int from public.health_exams), 1, 'A lê exame');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.health_insurance_cards), 1, 'cônjuge lê carteirinha da família');
select is((select count(*)::int from public.health_exams), 1, 'cônjuge lê exame da família');
select lives_ok(format($$ update public.health_exams set lab = 'Lab C' where id = %L $$, current_setting('t.ex_a')), 'cônjuge altera exame');
select is((select lab from public.health_exams), 'Lab C', 'alteração do cônjuge persistiu');
select lives_ok(format($$ insert into public.health_appointments (household_id, member_id, kind, starts_at, return_of)
  values (%L, %L, 'retorno', '2026-12-15 10:00-03', %L) $$, current_setting('t.ha'), current_setting('t.mc'), current_setting('t.ap_a')),
  'cônjuge cria retorno apontando para a consulta');
select lives_ok(format($$ update public.health_appointments set status = 'realizada' where id = %L $$, current_setting('t.ap_a')), 'cônjuge altera consulta');

-- B: não lê, não insere, não altera, não apaga --------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.health_insurance_cards), 0, 'B não lê carteirinhas de A');
select is((select count(*)::int from public.health_appointments), 0, 'B não lê consultas de A');
select is((select count(*)::int from public.health_exams), 0, 'B não lê exames de A');
select throws_ok(format($$ insert into public.health_insurance_cards (household_id, member_id, operator, file_path, file_mime, file_size)
  values (%L, %L, 'X', 'p', 'application/pdf', 1) $$, current_setting('t.ha'), current_setting('t.ma')), '42501', null, 'B não insere carteirinha em A');
select throws_ok(format($$ insert into public.health_appointments (household_id, member_id, starts_at) values (%L, %L, now()) $$,
  current_setting('t.ha'), current_setting('t.ma')), '42501', null, 'B não insere consulta em A');
select throws_ok(format($$ insert into public.health_exams (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.ma')), '42501', null, 'B não insere exame em A');
select is_empty(format($$ update public.health_insurance_cards set operator = 'hack' where id = %L returning 1 $$, current_setting('t.card_a')), 'B não altera carteirinha de A');
select is_empty(format($$ update public.health_appointments set notes = 'hack' where id = %L returning 1 $$, current_setting('t.ap_a')), 'B não altera consulta de A');
select is_empty(format($$ update public.health_exams set name = 'hack' where id = %L returning 1 $$, current_setting('t.ex_a')), 'B não altera exame de A');
select is_empty(format($$ delete from public.health_insurance_cards where id = %L returning 1 $$, current_setting('t.card_a')), 'B não apaga carteirinha de A');
select is_empty(format($$ delete from public.health_appointments where id = %L returning 1 $$, current_setting('t.ap_a')), 'B não apaga consulta de A');
select is_empty(format($$ delete from public.health_exams where id = %L returning 1 $$, current_setting('t.ex_a')), 'B não apaga exame de A');

-- FK composta: member_id de outra família --------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok(format($$ insert into public.health_exams (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.mb')), '23503', null, 'FK composta: exame com member_id de B é rejeitado');
select throws_ok(format($$ insert into public.health_appointments (household_id, member_id, starts_at) values (%L, %L, now()) $$,
  current_setting('t.ha'), current_setting('t.mb')), '23503', null, 'FK composta: consulta com member_id de B é rejeitada');
select throws_ok(format($$ insert into public.health_insurance_cards (household_id, member_id, operator, file_path, file_mime, file_size)
  values (%L, %L, 'X', 'p', 'application/pdf', 1) $$, current_setting('t.ha'), current_setting('t.mb')), '23503', null, 'FK composta: carteirinha com member_id de B é rejeitada');
-- return_of de outra família
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok(format($$ insert into public.health_appointments (household_id, member_id, starts_at) values (%L, %L, now()) $$,
  current_setting('t.hb'), current_setting('t.mb')), 'B cria a própria consulta');
select throws_ok(format($$ insert into public.health_appointments (household_id, member_id, kind, starts_at, return_of)
  values (%L, %L, 'retorno', now(), %L) $$, current_setting('t.hb'), current_setting('t.mb'), current_setting('t.ap_a')),
  '23503', null, 'FK composta: return_of de consulta de A é rejeitado para B');

-- checks ----------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok(format($$ insert into public.health_insurance_cards (household_id, member_id, operator, file_path, file_mime, file_size)
  values (%L, %L, 'X', 'p', 'image/png', 1) $$, current_setting('t.ha'), current_setting('t.ma')), '23514', null, 'carteirinha: mime fora da lista');
select throws_ok(format($$ insert into public.health_insurance_cards (household_id, member_id, operator, file_path, file_mime, file_size)
  values (%L, %L, 'X', 'p', 'application/pdf', 5242881) $$, current_setting('t.ha'), current_setting('t.ma')), '23514', null, 'carteirinha: arquivo acima de 5 MB');
select throws_ok(format($$ insert into public.health_insurance_cards (household_id, member_id, operator, file_path, file_mime, file_size)
  values (%L, %L, '', 'p', 'application/pdf', 1) $$, current_setting('t.ha'), current_setting('t.ma')), '23514', null, 'carteirinha: operadora vazia');
select throws_ok(format($$ insert into public.health_appointments (household_id, member_id, kind, starts_at) values (%L, %L, 'cirurgia', now()) $$,
  current_setting('t.ha'), current_setting('t.ma')), '23514', null, 'consulta: kind fora da lista');
select throws_ok(format($$ update public.health_appointments set status = 'sumiu' where id = %L $$, current_setting('t.ap_a')), '23514', null, 'consulta: status fora da lista');
select throws_ok(format($$ update public.health_appointments set notes = repeat('x', 1001) where id = %L $$, current_setting('t.ap_a')), '23514', null, 'consulta: notes acima de 1000');
select throws_ok(format($$ update public.health_exams set result_summary = repeat('x', 2001) where id = %L $$, current_setting('t.ex_a')), '23514', null, 'exame: result_summary acima de 2000');
select throws_ok(format($$ update public.health_exams set name = '' where id = %L $$, current_setting('t.ex_a')), '23514', null, 'exame: nome vazio');
select throws_ok(format($$ update public.health_exams set file_path = 'p' where id = %L $$, current_setting('t.ex_a')), '23514', null, 'exame: arquivo parcial (só file_path) é rejeitado');
select lives_ok(format($$ update public.health_exams set file_path = %L, file_mime = 'image/jpeg', file_size = 10 where id = %L $$,
  current_setting('t.pa_exam'), current_setting('t.ex_a')), 'exame: arquivo completo é aceito');

-- trigger updated_at -----------------------------------------------------------
reset role;
update public.health_exams set updated_at = '2000-01-01' where id = current_setting('t.ex_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.health_exams set lab = 'Lab Z' where id = current_setting('t.ex_a')::uuid;
select ok((select updated_at > '2000-01-01' from public.health_exams), 'trigger atualiza updated_at');

-- on delete set null em return_of; agenda_event_id sem FK -----------------------
select lives_ok(format($$ update public.health_appointments set agenda_event_id = gen_random_uuid() where id = %L $$, current_setting('t.ap_a')),
  'agenda_event_id aceita uuid sem FK');
select lives_ok(format($$ delete from public.health_appointments where id = %L $$, current_setting('t.ap_a')), 'A apaga a consulta original');
select is((select return_of from public.health_appointments where kind = 'retorno'), null, 'return_of vira null ao apagar a consulta original');

-- apagar (membro) ----------------------------------------------------------------
select lives_ok(format($$ delete from public.health_insurance_cards where id = %L $$, current_setting('t.card_a')), 'A apaga carteirinha');

-- anon ----------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.health_exams $$, '42501', null, 'anon não lê exames');
select throws_ok($$ select count(*) from public.health_insurance_cards $$, '42501', null, 'anon não lê carteirinhas');
select throws_ok($$ select count(*) from public.health_appointments $$, '42501', null, 'anon não lê consultas');
select throws_ok($$ select public.saude_path_household('x') $$, '42501', null, 'anon não executa saude_path_household');
reset role;

-- storage (delete direto em storage.objects é bloqueado pelo Supabase; só a API de Storage apaga, então a política de delete não é testável em SQL)
select is((select public from storage.buckets where id = 'saude'), false, 'bucket saude é privado');
select is((select file_size_limit from storage.buckets where id = 'saude'), 5242880::bigint, 'bucket saude limita 5 MB');
select is((select allowed_mime_types from storage.buckets where id = 'saude'), array['application/pdf','image/jpeg'], 'bucket saude só PDF e JPEG');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('saude', %L, %L) $$,
  current_setting('t.pa_card'), '00000000-0000-0000-0000-0000000000a1'), 'A envia arquivo para a pasta da própria família');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('saude', %L) $$, current_setting('t.pb_card')),
  '42501', null, 'A não envia arquivo para a pasta de B');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('saude', 'nao-e-uuid/cards/x.pdf') $$,
  '42501', null, 'caminho inválido é negado sem erro de cast');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('saude', %L) $$, current_setting('t.ha') || '/outra/x.pdf'),
  '42501', null, 'caminho fora do padrão é negado');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('outro', %L) $$, current_setting('t.pa_exam')),
  '42501', null, 'política não vale para outro bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'saude'), 1, 'A lê o próprio arquivo');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from storage.objects where bucket_id = 'saude'), 1, 'cônjuge lê arquivo da família');
select lives_ok(format($$ update storage.objects set name = %L where bucket_id = 'saude' and name = %L $$,
  current_setting('t.pa_exam'), current_setting('t.pa_card')), 'cônjuge atualiza arquivo na própria família');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from storage.objects where bucket_id = 'saude'), 0, 'B não lê arquivos de A');
select is_empty($$ update storage.objects set name = name where bucket_id = 'saude' returning 1 $$, 'B não altera arquivos de A');
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'saude'), 0, 'anon não lê arquivos do bucket');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

select * from finish();
rollback;
