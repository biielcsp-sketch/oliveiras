-- Saúde parte 1b: procedimentos, medicamentos e vacinas — isolamento por família,
-- FKs compostas, checks, trigger, anon e caminhos de storage novos.
begin;
select plan(88);

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
select set_config('t.u', '44444444-4444-4444-4444-444444444444', true);
select set_config('t.p_proc', current_setting('t.ha') || '/procedures/' || current_setting('t.u') || '.pdf', true);
select set_config('t.p_vac', current_setting('t.ha') || '/vaccines/' || current_setting('t.u') || '.jpg', true);
select set_config('t.pb_proc', current_setting('t.hb') || '/procedures/' || current_setting('t.u') || '.pdf', true);

-- A: cria e lê; cônjuge lê e altera (dados compartilhados) -----------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$ insert into public.health_procedures (household_id, member_id, name, performed_on) values (%L, %L, 'Endoscopia', '2026-05-01') $$,
  current_setting('t.ha'), current_setting('t.ma')), 'A cria procedimento sem arquivo');
select set_config('t.pr_a', (select id::text from public.health_procedures limit 1), true);
select lives_ok(format($$ insert into public.health_medications (household_id, member_id, name) values (%L, %L, 'Losartana') $$,
  current_setting('t.ha'), current_setting('t.ma')), 'A cria medicamento');
select set_config('t.md_a', (select id::text from public.health_medications limit 1), true);
select lives_ok(format($$ insert into public.health_vaccines (household_id, member_id, name, dose_label, applied_on, next_dose_on) values (%L, %L, 'Gripe', 'reforço', '2026-04-01', '2027-04-01') $$,
  current_setting('t.ha'), current_setting('t.ma')), 'A cria vacina');
select set_config('t.vc_a', (select id::text from public.health_vaccines limit 1), true);
select is((select active from public.health_medications), true, 'medicamento nasce ativo');
select is((select count(*)::int from public.health_procedures), 1, 'A lê procedimento');
select is((select count(*)::int from public.health_medications), 1, 'A lê medicamento');
select is((select count(*)::int from public.health_vaccines), 1, 'A lê vacina');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.health_procedures), 1, 'cônjuge lê procedimento');
select is((select count(*)::int from public.health_medications), 1, 'cônjuge lê medicamento');
select is((select count(*)::int from public.health_vaccines), 1, 'cônjuge lê vacina');
select lives_ok(format($$ update public.health_procedures set place = 'Hospital C' where id = %L $$, current_setting('t.pr_a')), 'cônjuge altera procedimento');
select is((select place from public.health_procedures), 'Hospital C', 'alteração persistiu');
select lives_ok(format($$ update public.health_medications set active = false where id = %L $$, current_setting('t.md_a')), 'cônjuge altera medicamento');
select lives_ok(format($$ update public.health_vaccines set lot = 'L1' where id = %L $$, current_setting('t.vc_a')), 'cônjuge altera vacina');
select lives_ok(format($$ insert into public.health_medications (household_id, member_id, name) values (%L, %L, 'Vitamina D') $$,
  current_setting('t.ha'), current_setting('t.mc')), 'cônjuge cria medicamento para si');

-- B: não lê, não insere, não altera, não apaga --------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.health_procedures), 0, 'B não lê procedimentos de A');
select is((select count(*)::int from public.health_medications), 0, 'B não lê medicamentos de A');
select is((select count(*)::int from public.health_vaccines), 0, 'B não lê vacinas de A');
select throws_ok(format($$ insert into public.health_procedures (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.ma')), '42501', null, 'B não insere procedimento em A');
select throws_ok(format($$ insert into public.health_medications (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.ma')), '42501', null, 'B não insere medicamento em A');
select throws_ok(format($$ insert into public.health_vaccines (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.ma')), '42501', null, 'B não insere vacina em A');
select is_empty(format($$ update public.health_procedures set name = 'hack' where id = %L returning 1 $$, current_setting('t.pr_a')), 'B não altera procedimento de A');
select is_empty(format($$ update public.health_medications set name = 'hack' where id = %L returning 1 $$, current_setting('t.md_a')), 'B não altera medicamento de A');
select is_empty(format($$ update public.health_vaccines set name = 'hack' where id = %L returning 1 $$, current_setting('t.vc_a')), 'B não altera vacina de A');
select is_empty(format($$ delete from public.health_procedures where id = %L returning 1 $$, current_setting('t.pr_a')), 'B não apaga procedimento de A');
select is_empty(format($$ delete from public.health_medications where id = %L returning 1 $$, current_setting('t.md_a')), 'B não apaga medicamento de A');
select is_empty(format($$ delete from public.health_vaccines where id = %L returning 1 $$, current_setting('t.vc_a')), 'B não apaga vacina de A');
-- B tentando mover registro para a própria família / reatribuir household_id
select is_empty(format($$ update public.health_vaccines set household_id = %L where id = %L returning 1 $$, current_setting('t.hb'), current_setting('t.vc_a')),
  'B não move vacina de A para B');

-- FK composta ------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok(format($$ insert into public.health_procedures (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.mb')), '23503', null, 'FK composta: procedimento com member_id de B');
select throws_ok(format($$ insert into public.health_medications (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.mb')), '23503', null, 'FK composta: medicamento com member_id de B');
select throws_ok(format($$ insert into public.health_vaccines (household_id, member_id, name) values (%L, %L, 'X') $$,
  current_setting('t.ha'), current_setting('t.mb')), '23503', null, 'FK composta: vacina com member_id de B');

-- checks -----------------------------------------------------------------------
select throws_ok(format($$ update public.health_procedures set name = '' where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: nome vazio');
select throws_ok(format($$ update public.health_procedures set name = repeat('x', 161) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: nome acima de 160');
select throws_ok(format($$ update public.health_procedures set notes = repeat('x', 2001) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: notes acima de 2000');
select throws_ok(format($$ update public.health_procedures set place = repeat('x', 201) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: place acima de 200');
select throws_ok(format($$ update public.health_procedures set doctor = repeat('x', 121) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: doctor acima de 120');
select throws_ok(format($$ update public.health_procedures set file_path = 'p' where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: arquivo parcial rejeitado');
select throws_ok(format($$ update public.health_procedures set file_path = 'p', file_mime = 'image/png', file_size = 1 where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: mime fora da lista');
select throws_ok(format($$ update public.health_procedures set file_path = 'p', file_mime = 'application/pdf', file_size = 5242881 where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: arquivo acima de 5 MB');
select throws_ok(format($$ update public.health_procedures set file_path = 'p', file_mime = 'application/pdf', file_size = 0 where id = %L $$, current_setting('t.pr_a')), '23514', null, 'procedimento: arquivo de tamanho 0');
select lives_ok(format($$ update public.health_procedures set file_path = %L, file_mime = 'application/pdf', file_size = 10 where id = %L $$,
  current_setting('t.p_proc'), current_setting('t.pr_a')), 'procedimento: arquivo completo aceito');
select throws_ok(format($$ update public.health_medications set name = '' where id = %L $$, current_setting('t.md_a')), '23514', null, 'medicamento: nome vazio');
select throws_ok(format($$ update public.health_medications set dosage = repeat('x', 121) where id = %L $$, current_setting('t.md_a')), '23514', null, 'medicamento: dosage acima de 120');
select throws_ok(format($$ update public.health_medications set frequency = repeat('x', 201) where id = %L $$, current_setting('t.md_a')), '23514', null, 'medicamento: frequency acima de 200');
select throws_ok(format($$ update public.health_medications set notes = repeat('x', 1001) where id = %L $$, current_setting('t.md_a')), '23514', null, 'medicamento: notes acima de 1000');
select throws_ok(format($$ update public.health_medications set prescribed_by = repeat('x', 121) where id = %L $$, current_setting('t.md_a')), '23514', null, 'medicamento: prescribed_by acima de 120');
select throws_ok(format($$ update public.health_medications set started_on = '2026-02-01', ended_on = '2026-01-01' where id = %L $$, current_setting('t.md_a')), '23514', null, 'medicamento: fim antes do início');
select lives_ok(format($$ update public.health_medications set started_on = '2026-01-01', ended_on = '2026-01-01' where id = %L $$, current_setting('t.md_a')), 'medicamento: fim igual ao início aceito');
select lives_ok(format($$ update public.health_medications set started_on = null, ended_on = '2020-01-01' where id = %L $$, current_setting('t.md_a')), 'medicamento: fim sem início aceito');
select throws_ok(format($$ update public.health_vaccines set name = '' where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: nome vazio');
select throws_ok(format($$ update public.health_vaccines set dose_label = repeat('x', 61) where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: dose_label acima de 60');
select throws_ok(format($$ update public.health_vaccines set lot = repeat('x', 61) where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: lot acima de 60');
select throws_ok(format($$ update public.health_vaccines set place = repeat('x', 201) where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: place acima de 200');
select throws_ok(format($$ update public.health_vaccines set notes = repeat('x', 1001) where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: notes acima de 1000');
select throws_ok(format($$ update public.health_vaccines set file_mime = 'application/pdf' where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: arquivo parcial rejeitado');
select throws_ok(format($$ update public.health_vaccines set file_path = 'p', file_mime = 'image/gif', file_size = 1 where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: mime fora da lista');
select throws_ok(format($$ update public.health_vaccines set file_path = 'p', file_mime = 'image/jpeg', file_size = 5242881 where id = %L $$, current_setting('t.vc_a')), '23514', null, 'vacina: arquivo acima de 5 MB');
select lives_ok(format($$ update public.health_vaccines set file_path = %L, file_mime = 'image/jpeg', file_size = 10 where id = %L $$,
  current_setting('t.p_vac'), current_setting('t.vc_a')), 'vacina: comprovante completo aceito');

-- trigger updated_at -----------------------------------------------------------
reset role;
update public.health_procedures set updated_at = '2000-01-01' where id = current_setting('t.pr_a')::uuid;
update public.health_medications set updated_at = '2000-01-01' where id = current_setting('t.md_a')::uuid;
update public.health_vaccines set updated_at = '2000-01-01' where id = current_setting('t.vc_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.health_procedures set place = 'Z' where id = current_setting('t.pr_a')::uuid;
update public.health_medications set notes = 'Z' where id = current_setting('t.md_a')::uuid;
update public.health_vaccines set notes = 'Z' where id = current_setting('t.vc_a')::uuid;
select ok((select updated_at > '2000-01-01' from public.health_procedures), 'trigger atualiza updated_at (procedimentos)');
select ok((select updated_at > '2000-01-01' from public.health_medications where id = current_setting('t.md_a')::uuid), 'trigger atualiza updated_at (medicamentos)');
select ok((select updated_at > '2000-01-01' from public.health_vaccines), 'trigger atualiza updated_at (vacinas)');

-- apagar (membro) ----------------------------------------------------------------
select lives_ok(format($$ delete from public.health_procedures where id = %L $$, current_setting('t.pr_a')), 'A apaga procedimento');
select lives_ok(format($$ delete from public.health_medications where id = %L $$, current_setting('t.md_a')), 'A apaga medicamento');
select lives_ok(format($$ delete from public.health_vaccines where id = %L $$, current_setting('t.vc_a')), 'A apaga vacina');
select is((select count(*)::int from public.health_procedures), 0, 'procedimento apagado');

-- anon ----------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.health_procedures $$, '42501', null, 'anon não lê procedimentos');
select throws_ok($$ select count(*) from public.health_medications $$, '42501', null, 'anon não lê medicamentos');
select throws_ok($$ select count(*) from public.health_vaccines $$, '42501', null, 'anon não lê vacinas');
select throws_ok($$ insert into public.health_vaccines (household_id, member_id, name) values (gen_random_uuid(), gen_random_uuid(), 'X') $$, '42501', null, 'anon não insere vacina');
select throws_ok($$ select public.saude_path_household('x') $$, '42501', null, 'anon não executa saude_path_household');
reset role;

-- grants da função preservados após create or replace -------------------------------
select ok(has_function_privilege('authenticated', 'public.saude_path_household(text)', 'execute'), 'authenticated executa saude_path_household');
select ok(not has_function_privilege('anon', 'public.saude_path_household(text)', 'execute'), 'anon sem execute em saude_path_household');
select is((select proconfig from pg_proc where oid = 'public.saude_path_household(text)'::regprocedure), array['search_path=""'], 'saude_path_household mantém search_path vazio');

-- função de caminho --------------------------------------------------------------------
select is(public.saude_path_household(current_setting('t.p_proc')), current_setting('t.ha')::uuid, 'função aceita procedures/');
select is(public.saude_path_household(current_setting('t.p_vac')), current_setting('t.ha')::uuid, 'função aceita vaccines/');
select is(public.saude_path_household(current_setting('t.ha') || '/cards/' || current_setting('t.u') || '.pdf'), current_setting('t.ha')::uuid, 'função segue aceitando cards/');
select is(public.saude_path_household(current_setting('t.ha') || '/exams/' || current_setting('t.u') || '.jpg'), current_setting('t.ha')::uuid, 'função segue aceitando exams/');
select is(public.saude_path_household(current_setting('t.ha') || '/medications/' || current_setting('t.u') || '.pdf'), null, 'função nega tipo inválido');
select is(public.saude_path_household(current_setting('t.ha') || '/procedures/' || current_setting('t.u') || '.png'), null, 'função nega extensão inválida');
select is(public.saude_path_household('nao-e-uuid/procedures/' || current_setting('t.u') || '.pdf'), null, 'função nega household inválido sem erro de cast');
select is(public.saude_path_household(current_setting('t.ha') || '/procedures/x.pdf'), null, 'função nega nome de arquivo não-uuid');
select is(public.saude_path_household(current_setting('t.ha') || '/procedures/' || current_setting('t.u') || '.pdf/extra'), null, 'função nega sufixo extra');

-- políticas de storage com os novos tipos --------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('saude', %L, %L) $$,
  current_setting('t.p_proc'), '00000000-0000-0000-0000-0000000000a1'), 'A envia arquivo em procedures/');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('saude', %L, %L) $$,
  current_setting('t.p_vac'), '00000000-0000-0000-0000-0000000000a1'), 'A envia arquivo em vaccines/');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('saude', %L) $$, current_setting('t.pb_proc')),
  '42501', null, 'A não envia em procedures/ de B');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('saude', %L) $$, current_setting('t.ha') || '/medications/' || current_setting('t.u') || '.pdf'),
  '42501', null, 'tipo inválido é negado no storage');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from storage.objects where bucket_id = 'saude'), 2, 'cônjuge lê arquivos novos da família');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from storage.objects where bucket_id = 'saude'), 0, 'B não lê arquivos novos de A');
reset role;

select * from finish();
rollback;
