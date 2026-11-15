-- Exames de laboratório: RLS por família, FKs compostas, checks, unique e cascade.
begin;
select plan(28);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000025a1', 'la@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000025a2', 'lb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000025a3', 'lc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000025a1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000025a2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.code_a', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000025a3');
select public.join_household(current_setting('t.code_a'), 'Caio');
reset role;
select set_config('t.ma', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000025a1'), true);
select set_config('t.mc', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000025a3'), true);
select set_config('t.mb', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000025a2'), true);

select ok((select relrowsecurity from pg_class where oid = 'public.health_lab_reports'::regclass), 'RLS ligado em health_lab_reports');
select ok((select relrowsecurity from pg_class where oid = 'public.health_lab_results'::regclass), 'RLS ligado em health_lab_results');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000025a1');

-- A cria relatório (com arquivo) e resultados
select set_config('t.rep_a', gen_random_uuid()::text, true);
select lives_ok(format($$ insert into public.health_lab_reports (id, household_id, member_id, collected_on, lab, file_path, file_mime, file_size)
  values (%L, %L, %L, '2026-11-01', 'Lab X', %L, 'application/pdf', 1000) $$,
  current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma'),
  current_setting('t.ha') || '/exams/44444444-4444-4444-4444-444444444444.pdf'), 'A cria relatório');
select lives_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category, value_num, unit, ref_min, ref_max)
  values (%L, %L, %L, 'colesterol-total', 'Colesterol total', 'cardiovascular', 180, 'mg/dL', 0, 190) $$,
  current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma')), 'A cria resultado numérico');
select lives_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category, value_text)
  values (%L, %L, %L, 'hiv', 'HIV', 'imunidade', 'Não reagente') $$,
  current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma')), 'A cria resultado textual');
select is((select count(*)::int from public.health_lab_reports where id = current_setting('t.rep_a')::uuid), 1, 'A lê relatório');
select is((select count(*)::int from public.health_lab_results where report_id = current_setting('t.rep_a')::uuid), 2, 'A lê resultados');

-- Cônjuge (mesma família) lê e escreve: dados compartilhados
select pg_temp.as_user('00000000-0000-0000-0000-0000000025a3');
select is((select count(*)::int from public.health_lab_results where report_id = current_setting('t.rep_a')::uuid), 2, 'cônjuge lê resultados');
select lives_ok(format($$ update public.health_lab_reports set lab = 'Lab C' where id = %L $$, current_setting('t.rep_a')), 'cônjuge edita relatório');
select is((select lab from public.health_lab_reports where id = current_setting('t.rep_a')::uuid), 'Lab C', 'edição persistiu');
select lives_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category, value_num)
  values (%L, %L, %L, 'glicose', 'Glicose', 'metabolismo', 90) $$,
  current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma')), 'cônjuge cria resultado (do membro A)');
select lives_ok(format($$ delete from public.health_lab_results where report_id = %L and biomarker_key = 'glicose' $$, current_setting('t.rep_a')), 'cônjuge apaga resultado');

-- Outra família: não lê, não insere, não altera, não apaga
select pg_temp.as_user('00000000-0000-0000-0000-0000000025a2');
select is((select count(*)::int from public.health_lab_reports where id = current_setting('t.rep_a')::uuid), 0, 'B não lê relatório de A');
select is((select count(*)::int from public.health_lab_results where report_id = current_setting('t.rep_a')::uuid), 0, 'B não lê resultados de A');
select throws_ok(format($$ insert into public.health_lab_reports (household_id, member_id, collected_on) values (%L, %L, '2026-11-02') $$,
  current_setting('t.ha'), current_setting('t.ma')), '42501', null, 'B não insere relatório em A');
select throws_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category, value_num)
  values (%L, %L, %L, 'x', 'X', 'outros', 1) $$, current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma')),
  '42501', null, 'B não insere resultado em A');
update public.health_lab_reports set lab = 'Hack' where id = current_setting('t.rep_a')::uuid;
update public.health_lab_results set name = 'Hack' where report_id = current_setting('t.rep_a')::uuid;
delete from public.health_lab_results where report_id = current_setting('t.rep_a')::uuid;
delete from public.health_lab_reports where id = current_setting('t.rep_a')::uuid;
reset role;
select is((select lab from public.health_lab_reports where id = current_setting('t.rep_a')::uuid), 'Lab C', 'B não alterou/apagou relatório de A');
select is((select count(*)::int from public.health_lab_results where report_id = current_setting('t.rep_a')::uuid and name = 'Hack'), 0, 'B não alterou resultados de A');
select is((select count(*)::int from public.health_lab_results where report_id = current_setting('t.rep_a')::uuid), 2, 'B não apagou resultados de A');

-- anon não lê
set local role anon;
select throws_ok($$ select count(*) from public.health_lab_reports $$, '42501', null, 'anon não lê relatórios');
select throws_ok($$ select count(*) from public.health_lab_results $$, '42501', null, 'anon não lê resultados');
reset role;

-- Checks, unique, FK composta (como A)
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000025a1');
select throws_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category, value_num)
  values (%L, %L, %L, 'k1', 'K1', 'invalida', 1) $$, current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma')),
  '23514', null, 'categoria inválida rejeitada');
select throws_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category)
  values (%L, %L, %L, 'k2', 'K2', 'outros') $$, current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma')),
  '23514', null, 'resultado sem valor rejeitado');
select throws_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category, value_num)
  values (%L, %L, %L, 'colesterol-total', 'Dup', 'cardiovascular', 1) $$, current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.ma')),
  '23505', null, 'biomarcador duplicado no relatório rejeitado');
select throws_ok(format($$ insert into public.health_lab_results (report_id, household_id, member_id, biomarker_key, name, category, value_num)
  values (%L, %L, %L, 'k3', 'K3', 'outros', 1) $$, current_setting('t.rep_a'), current_setting('t.ha'), current_setting('t.mc')),
  '23503', null, 'resultado de membro diferente do relatório rejeitado');
select throws_ok(format($$ insert into public.health_lab_reports (household_id, member_id, collected_on, file_path) values (%L, %L, '2026-11-02', 'x') $$,
  current_setting('t.ha'), current_setting('t.ma')), '23514', null, 'arquivo tudo-ou-nada');

-- Cascade ao apagar relatório
select lives_ok(format($$ delete from public.health_lab_reports where id = %L $$, current_setting('t.rep_a')), 'A apaga relatório');
select is((select count(*)::int from public.health_lab_results where report_id = current_setting('t.rep_a')::uuid), 0, 'resultados apagados em cascata');

select * from finish();
rollback;
