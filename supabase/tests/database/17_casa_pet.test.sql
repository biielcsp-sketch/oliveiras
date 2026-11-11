-- Casa: aba Pet — casa_pets, casa_pet_health, casa_pet_vet, casa_pet_care,
-- casa_pet_care_log, casa_pet_weights, casa_pet_food. Isolamento por família,
-- FKs compostas, checks, tudo-ou-nada do arquivo, unique de peso por dia,
-- cascades, updated_at, anon e função de caminho (docs/ e pets/).
begin;
select plan(231);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'fa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'fb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'fc@teste.invalid', 'authenticated', 'authenticated');

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

select set_config('t.fa', current_setting('t.ha') || '/pets/11111111-1111-1111-1111-111111111111.pdf', true);
select set_config('t.fa2', current_setting('t.ha') || '/pets/22222222-2222-2222-2222-222222222222.jpg', true);
select set_config('t.fb', current_setting('t.hb') || '/pets/33333333-3333-3333-3333-333333333333.pdf', true);

-- 00_helpers / estrutura -------------------------------------------------------------
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'todas as tabelas de public (inclusive as novas) têm RLS ligado');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = t
  and roles = '{authenticated}' and coalesce(qual, with_check) like '%is_household_member(' || t || '.household_id)%'), 4,
  '4 políticas por família em ' || t)
from unnest(array['casa_pets','casa_pet_health','casa_pet_vet','casa_pet_care','casa_pet_care_log',
  'casa_pet_weights','casa_pet_food']) as t;
select has_index('public', t, i, 'índice ' || i)
from (values ('casa_pets','casa_pets_household_idx'),
             ('casa_pet_health','casa_pet_health_pet_idx'), ('casa_pet_health','casa_pet_health_household_due_idx'),
             ('casa_pet_vet','casa_pet_vet_pet_idx'), ('casa_pet_vet','casa_pet_vet_household_idx'),
             ('casa_pet_care','casa_pet_care_pet_idx'), ('casa_pet_care','casa_pet_care_household_due_idx'),
             ('casa_pet_care','casa_pet_care_provider_idx'),
             ('casa_pet_care_log','casa_pet_care_log_care_idx'), ('casa_pet_care_log','casa_pet_care_log_household_idx'),
             ('casa_pet_care_log','casa_pet_care_log_done_by_idx'),
             ('casa_pet_weights','casa_pet_weights_pet_idx'), ('casa_pet_weights','casa_pet_weights_household_idx'),
             ('casa_pet_food','casa_pet_food_pet_idx'), ('casa_pet_food','casa_pet_food_household_idx')) as x(t, i);

-- B cria registros próprios (FKs compostas e isolamento) ------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
insert into public.casa_pets (household_id, name) values (current_setting('t.hb')::uuid, 'Rex B');
select set_config('t.pet_b', (select id::text from public.casa_pets), true);
insert into public.casa_providers (household_id, name) values (current_setting('t.hb')::uuid, 'Pet shop B');
select set_config('t.pr_b', (select id::text from public.casa_providers), true);
insert into public.casa_pet_care (household_id, pet_id, name, interval_value, interval_unit)
  values (current_setting('t.hb')::uuid, current_setting('t.pet_b')::uuid, 'Banho B', 15, 'dias');
select set_config('t.care_b', (select id::text from public.casa_pet_care), true);

-- 1) Pets ---------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ insert into public.casa_pets (household_id, name, breed, sex, birth_date) values (%L, 'Moisés', 'SRD', 'macho', '2022-03-01') $$,
  current_setting('t.ha')), 'A cria pet');
select set_config('t.pet_a', (select id::text from public.casa_pets), true);
select is((select species from public.casa_pets), 'cachorro', 'species padrão = cachorro');
select lives_ok(format($$ insert into public.casa_pets (household_id, name, species, sex) values (%L, 'Mia', 'gato', 'femea') $$,
  current_setting('t.ha')), 'A cria segundo pet (gato, fêmea)');
select set_config('t.pet_a2', (select id::text from public.casa_pets where name = 'Mia'), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.casa_pets), 2, 'cônjuge lê os pets da família');
select lives_ok(format($$ update public.casa_pets set notes = 'dócil' where id = %L $$, current_setting('t.pet_a')), 'cônjuge altera pet');
select throws_ok(format($$ update public.casa_pets set species = 'peixe' where id = %L $$, current_setting('t.pet_a')), '23514', null, 'species fora da lista');
select lives_ok(format($$ update public.casa_pets set species = 'outro' where id = %L $$, current_setting('t.pet_a2')), 'species outro aceito');
select throws_ok(format($$ update public.casa_pets set species = null where id = %L $$, current_setting('t.pet_a')), '23502', null, 'species não aceita null');
select throws_ok(format($$ update public.casa_pets set sex = 'fêmea' where id = %L $$, current_setting('t.pet_a')), '23514', null, 'sex fora da lista');
select throws_ok(format($$ update public.casa_pets set sex = 'M' where id = %L $$, current_setting('t.pet_a')), '23514', null, 'sex abreviado recusado');
select lives_ok(format($$ update public.casa_pets set sex = null where id = %L $$, current_setting('t.pet_a2')), 'sex nulo aceito');
select throws_ok(format($$ update public.casa_pets set name = '' where id = %L $$, current_setting('t.pet_a')), '23514', null, 'pet: nome vazio');
select throws_ok(format($$ update public.casa_pets set name = repeat('x', 61) where id = %L $$, current_setting('t.pet_a')), '23514', null, 'pet: nome acima de 60');
select lives_ok(format($$ update public.casa_pets set name = repeat('x', 60) where id = %L $$, current_setting('t.pet_a2')), 'pet: nome com 60 aceito');
select throws_ok(format($$ update public.casa_pets set breed = repeat('x', 61) where id = %L $$, current_setting('t.pet_a')), '23514', null, 'pet: breed acima de 60');
select throws_ok(format($$ update public.casa_pets set notes = repeat('x', 501) where id = %L $$, current_setting('t.pet_a')), '23514', null, 'pet: notes acima de 500');

-- 2) Vacinas e remédios --------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ insert into public.casa_pet_health (household_id, pet_id, kind, name, dose, applied_on, next_due_on, file_path, file_mime, file_size)
  values (%L, %L, 'vacina', 'V10', '1 ml', '2026-01-10', '2027-01-10', %L, 'application/pdf', 1000) $$,
  current_setting('t.ha'), current_setting('t.pet_a'), current_setting('t.fa')), 'A registra vacina com arquivo');
select set_config('t.hl_a', (select id::text from public.casa_pet_health), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.casa_pet_health), 1, 'cônjuge lê vacinas');
select lives_ok(format($$ update public.casa_pet_health set notes = 'ok' where id = %L $$, current_setting('t.hl_a')), 'cônjuge altera vacina');
select throws_ok(format($$ update public.casa_pet_health set kind = 'banho' where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde: kind fora da lista');
select lives_ok(format($$ update public.casa_pet_health set kind = %L where id = %L $$, k, current_setting('t.hl_a')), 'saúde: kind ' || k || ' aceito')
from unnest(array['vermifugo','antipulgas','remedio','vacina']) as k;
select throws_ok(format($$ update public.casa_pet_health set kind = null where id = %L $$, current_setting('t.hl_a')), '23502', null, 'saúde: kind não aceita null');
select throws_ok(format($$ update public.casa_pet_health set next_due_on = '2026-01-09' where id = %L $$, current_setting('t.hl_a')), '23514', null, 'próxima dose antes da aplicação');
select lives_ok(format($$ update public.casa_pet_health set next_due_on = '2026-01-10' where id = %L $$, current_setting('t.hl_a')), 'próxima dose no mesmo dia aceita');
select lives_ok(format($$ update public.casa_pet_health set applied_on = null, next_due_on = '2020-01-01' where id = %L $$, current_setting('t.hl_a')), 'próxima dose sem aplicação aceita');
select throws_ok(format($$ update public.casa_pet_health set name = '' where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde: nome vazio');
select throws_ok(format($$ update public.casa_pet_health set name = repeat('x', 121) where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde: nome acima de 120');
select throws_ok(format($$ update public.casa_pet_health set dose = repeat('x', 61) where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde: dose acima de 60');
select throws_ok(format($$ update public.casa_pet_health set notes = repeat('x', 501) where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde: notes acima de 500');
select throws_ok(format($$ update public.casa_pet_health set file_path = null where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde/arquivo: sem path com mime/size');
select throws_ok(format($$ update public.casa_pet_health set file_mime = null where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde/arquivo: sem mime com path/size');
select throws_ok(format($$ update public.casa_pet_health set file_size = null where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde/arquivo: sem size com path/mime');
select throws_ok(format($$ update public.casa_pet_health set file_mime = 'image/png' where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde/arquivo: mime png');
select throws_ok(format($$ update public.casa_pet_health set file_size = 0 where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde/arquivo: vazio');
select throws_ok(format($$ update public.casa_pet_health set file_size = 5242881 where id = %L $$, current_setting('t.hl_a')), '23514', null, 'saúde/arquivo: acima de 5 MB');
select throws_ok(format($$ update public.casa_pet_health set file_path = %L where id = %L $$, repeat('x', 301), current_setting('t.hl_a')), '23514', null, 'saúde/arquivo: path acima de 300');
select lives_ok(format($$ update public.casa_pet_health set file_path = %L, file_mime = 'image/jpeg', file_size = 5242880 where id = %L $$, current_setting('t.fa2'), current_setting('t.hl_a')), 'saúde/arquivo: jpeg de 5 MB aceito');
select lives_ok(format($$ update public.casa_pet_health set file_path = null, file_mime = null, file_size = null where id = %L $$, current_setting('t.hl_a')), 'saúde/arquivo: remover os três juntos aceito');

-- 3) Veterinário -------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ insert into public.casa_pet_vet (household_id, pet_id, kind, happened_on, clinic, vet, reason, cost, file_path, file_mime, file_size)
  values (%L, %L, 'consulta', '2026-10-01', 'Clínica X', 'Dra. Y', 'Coceira', 150, %L, 'application/pdf', 10) $$,
  current_setting('t.ha'), current_setting('t.pet_a'), current_setting('t.fa')), 'A registra consulta');
select set_config('t.vet_a', (select id::text from public.casa_pet_vet), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.casa_pet_vet), 1, 'cônjuge lê veterinário');
select lives_ok(format($$ update public.casa_pet_vet set notes = repeat('x', 2000) where id = %L $$, current_setting('t.vet_a')), 'cônjuge altera; notes com 2000 aceito');
select throws_ok(format($$ update public.casa_pet_vet set kind = 'vacina' where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet: kind fora da lista');
select lives_ok(format($$ update public.casa_pet_vet set kind = %L where id = %L $$, k, current_setting('t.vet_a')), 'vet: kind ' || k || ' aceito')
from unnest(array['exame','receita','outro','consulta']) as k;
select throws_ok(format($$ update public.casa_pet_vet set happened_on = null where id = %L $$, current_setting('t.vet_a')), '23502', null, 'vet: data obrigatória');
select throws_ok(format($$ update public.casa_pet_vet set clinic = repeat('x', 121) where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet: clinic acima de 120');
select throws_ok(format($$ update public.casa_pet_vet set vet = repeat('x', 121) where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet: vet acima de 120');
select throws_ok(format($$ update public.casa_pet_vet set reason = repeat('x', 201) where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet: reason acima de 200');
select throws_ok(format($$ update public.casa_pet_vet set notes = repeat('x', 2001) where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet: notes acima de 2000');
select throws_ok(format($$ update public.casa_pet_vet set cost = -0.01 where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet: custo negativo');
select lives_ok(format($$ update public.casa_pet_vet set cost = 0 where id = %L $$, current_setting('t.vet_a')), 'vet: custo zero aceito');
select throws_ok(format($$ update public.casa_pet_vet set file_size = null where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet/arquivo: sem size com path/mime');
select throws_ok(format($$ insert into public.casa_pet_vet (household_id, pet_id, kind, happened_on, file_path) values (%L, %L, 'exame', '2026-10-02', 'p') $$,
  current_setting('t.ha'), current_setting('t.pet_a')), '23514', null, 'vet/arquivo: só path');
select throws_ok(format($$ update public.casa_pet_vet set file_mime = 'image/png' where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet/arquivo: mime png');
select throws_ok(format($$ update public.casa_pet_vet set file_size = 5242881 where id = %L $$, current_setting('t.vet_a')), '23514', null, 'vet/arquivo: acima de 5 MB');

-- 4) Cuidados recorrentes -----------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ insert into public.casa_providers (household_id, name, service) values (%L, 'Pet shop A', 'banho') $$,
  current_setting('t.ha')), 'A cria prestador');
select set_config('t.pr_a', (select id::text from public.casa_providers), true);
select lives_ok(format($$ insert into public.casa_pet_care (household_id, pet_id, name, interval_value, interval_unit, last_done_on, next_due_on, provider_id)
  values (%L, %L, 'Banho', 15, 'dias', '2026-11-01', '2026-11-16', %L) $$,
  current_setting('t.ha'), current_setting('t.pet_a'), current_setting('t.pr_a')), 'A cria cuidado ligado a prestador');
select set_config('t.care_a', (select id::text from public.casa_pet_care), true);
select is((select active from public.casa_pet_care), true, 'active nasce true');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.casa_pet_care), 1, 'cônjuge lê cuidados');
select lives_ok(format($$ update public.casa_pet_care set notes = 'x' where id = %L $$, current_setting('t.care_a')), 'cônjuge altera cuidado');
select throws_ok(format($$ update public.casa_pet_care set interval_unit = 'anos' where id = %L $$, current_setting('t.care_a')), '23514', null, 'cuidado: unidade anos recusada');
select lives_ok(format($$ update public.casa_pet_care set interval_unit = %L where id = %L $$, u, current_setting('t.care_a')), 'cuidado: unidade ' || u || ' aceita')
from unnest(array['semanas','meses','dias']) as u;
select throws_ok(format($$ update public.casa_pet_care set interval_value = 0 where id = %L $$, current_setting('t.care_a')), '23514', null, 'cuidado: intervalo 0');
select throws_ok(format($$ update public.casa_pet_care set interval_value = 366 where id = %L $$, current_setting('t.care_a')), '23514', null, 'cuidado: intervalo 366');
select lives_ok(format($$ update public.casa_pet_care set interval_value = 365 where id = %L $$, current_setting('t.care_a')), 'cuidado: intervalo 365 aceito');
select throws_ok(format($$ update public.casa_pet_care set name = '' where id = %L $$, current_setting('t.care_a')), '23514', null, 'cuidado: nome vazio');
select throws_ok(format($$ update public.casa_pet_care set name = repeat('x', 121) where id = %L $$, current_setting('t.care_a')), '23514', null, 'cuidado: nome acima de 120');
select throws_ok(format($$ update public.casa_pet_care set notes = repeat('x', 501) where id = %L $$, current_setting('t.care_a')), '23514', null, 'cuidado: notes acima de 500');
select throws_ok(format($$ update public.casa_pet_care set active = null where id = %L $$, current_setting('t.care_a')), '23502', null, 'cuidado: active não aceita null');

-- 5) Histórico dos cuidados -----------------------------------------------------------------------
select lives_ok(format($$ insert into public.casa_pet_care_log (household_id, care_id, done_on, cost) values (%L, %L, '2026-11-10', 60) $$,
  current_setting('t.ha'), current_setting('t.care_a')), 'cônjuge registra cuidado feito');
select set_config('t.log_a', (select id::text from public.casa_pet_care_log), true);
select is((select done_by from public.casa_pet_care_log), '00000000-0000-0000-0000-0000000000f3'::uuid, 'done_by = auth.uid()');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.casa_pet_care_log), 1, 'A lê histórico do cônjuge');
select lives_ok(format($$ update public.casa_pet_care_log set notes = 'ok' where id = %L $$, current_setting('t.log_a')), 'A altera histórico');
select throws_ok(format($$ update public.casa_pet_care_log set cost = -1 where id = %L $$, current_setting('t.log_a')), '23514', null, 'histórico: custo negativo');
select lives_ok(format($$ update public.casa_pet_care_log set cost = null where id = %L $$, current_setting('t.log_a')), 'histórico: custo nulo aceito');
select throws_ok(format($$ update public.casa_pet_care_log set done_on = null where id = %L $$, current_setting('t.log_a')), '23502', null, 'histórico: data obrigatória');
select throws_ok(format($$ update public.casa_pet_care_log set notes = repeat('x', 501) where id = %L $$, current_setting('t.log_a')), '23514', null, 'histórico: notes acima de 500');

-- 6) Peso ------------------------------------------------------------------------------------------
select lives_ok(format($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (%L, %L, '2026-11-01', 12.5) $$,
  current_setting('t.ha'), current_setting('t.pet_a')), 'A registra peso');
select set_config('t.w_a', (select id::text from public.casa_pet_weights), true);
select throws_ok(format($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (%L, %L, '2026-11-01', 13) $$,
  current_setting('t.ha'), current_setting('t.pet_a')), '23505', null, 'unique: dois pesos do mesmo pet no mesmo dia recusado');
select lives_ok(format($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (%L, %L, '2026-11-01', 4) $$,
  current_setting('t.ha'), current_setting('t.pet_a2')), 'outro pet pode pesar no mesmo dia');
select throws_ok(format($$ update public.casa_pet_weights set weight_kg = 0 where id = %L $$, current_setting('t.w_a')), '23514', null, 'peso zero');
select throws_ok(format($$ update public.casa_pet_weights set weight_kg = -1 where id = %L $$, current_setting('t.w_a')), '23514', null, 'peso negativo');
select throws_ok(format($$ update public.casa_pet_weights set weight_kg = 200 where id = %L $$, current_setting('t.w_a')), '23514', null, 'peso 200');
select lives_ok(format($$ update public.casa_pet_weights set weight_kg = 199.99 where id = %L $$, current_setting('t.w_a')), 'peso 199.99 aceito');
select lives_ok(format($$ update public.casa_pet_weights set weight_kg = 0.01 where id = %L $$, current_setting('t.w_a')), 'peso 0.01 aceito');
select throws_ok(format($$ update public.casa_pet_weights set weight_kg = null where id = %L $$, current_setting('t.w_a')), '23502', null, 'peso obrigatório');
select throws_ok(format($$ update public.casa_pet_weights set measured_on = null where id = %L $$, current_setting('t.w_a')), '23502', null, 'data do peso obrigatória');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.casa_pet_weights), 2, 'cônjuge lê pesos');
select lives_ok(format($$ update public.casa_pet_weights set weight_kg = 12.7 where id = %L $$, current_setting('t.w_a')), 'cônjuge altera peso');

-- 7) Ração -------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ insert into public.casa_pet_food (household_id, pet_id, brand, bag_kg, daily_grams, started_on) values (%L, %L, 'Marca X', 15, 250, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.pet_a')), 'A registra ração');
select set_config('t.food_a', (select id::text from public.casa_pet_food), true);
select is((select active from public.casa_pet_food), true, 'ração: active nasce true');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.casa_pet_food), 1, 'cônjuge lê ração');
select lives_ok(format($$ update public.casa_pet_food set notes = 'ok' where id = %L $$, current_setting('t.food_a')), 'cônjuge altera ração');
select throws_ok(format($$ update public.casa_pet_food set bag_kg = 0 where id = %L $$, current_setting('t.food_a')), '23514', null, 'ração: saco 0 kg');
select throws_ok(format($$ update public.casa_pet_food set bag_kg = 100.01 where id = %L $$, current_setting('t.food_a')), '23514', null, 'ração: saco acima de 100 kg');
select lives_ok(format($$ update public.casa_pet_food set bag_kg = 100 where id = %L $$, current_setting('t.food_a')), 'ração: saco de 100 kg aceito');
select throws_ok(format($$ update public.casa_pet_food set bag_kg = null where id = %L $$, current_setting('t.food_a')), '23502', null, 'ração: saco obrigatório');
select throws_ok(format($$ update public.casa_pet_food set daily_grams = 0 where id = %L $$, current_setting('t.food_a')), '23514', null, 'ração: 0 g/dia');
select throws_ok(format($$ update public.casa_pet_food set daily_grams = 5001 where id = %L $$, current_setting('t.food_a')), '23514', null, 'ração: acima de 5000 g/dia');
select lives_ok(format($$ update public.casa_pet_food set daily_grams = null where id = %L $$, current_setting('t.food_a')), 'ração: g/dia nulo aceito');
select throws_ok(format($$ update public.casa_pet_food set brand = '' where id = %L $$, current_setting('t.food_a')), '23514', null, 'ração: marca vazia');
select throws_ok(format($$ update public.casa_pet_food set brand = repeat('x', 121) where id = %L $$, current_setting('t.food_a')), '23514', null, 'ração: marca acima de 120');
select throws_ok(format($$ update public.casa_pet_food set started_on = null where id = %L $$, current_setting('t.food_a')), '23502', null, 'ração: início obrigatório');
select throws_ok(format($$ update public.casa_pet_food set active = null where id = %L $$, current_setting('t.food_a')), '23502', null, 'ração: active não aceita null');
select throws_ok(format($$ update public.casa_pet_food set notes = repeat('x', 301) where id = %L $$, current_setting('t.food_a')), '23514', null, 'ração: notes acima de 300');

-- 8) FKs compostas: registro de outra família barrado ----------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok(format($$ insert into public.casa_pet_health (household_id, pet_id, kind, name) values (%L, %L, 'vacina', 'X') $$,
  current_setting('t.ha'), current_setting('t.pet_b')), '23503', null, 'FK: saúde com pet de B recusada');
select throws_ok(format($$ update public.casa_pet_health set pet_id = %L where id = %L $$, current_setting('t.pet_b'), current_setting('t.hl_a')),
  '23503', null, 'FK: saúde movida para pet de B recusada');
select throws_ok(format($$ insert into public.casa_pet_vet (household_id, pet_id, kind, happened_on) values (%L, %L, 'consulta', '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.pet_b')), '23503', null, 'FK: veterinário com pet de B recusado');
select throws_ok(format($$ insert into public.casa_pet_care (household_id, pet_id, name, interval_value, interval_unit) values (%L, %L, 'X', 1, 'dias') $$,
  current_setting('t.ha'), current_setting('t.pet_b')), '23503', null, 'FK: cuidado com pet de B recusado');
select throws_ok(format($$ update public.casa_pet_care set provider_id = %L where id = %L $$, current_setting('t.pr_b'), current_setting('t.care_a')),
  '23503', null, 'FK: cuidado com prestador de B recusado (update)');
select throws_ok(format($$ insert into public.casa_pet_care (household_id, pet_id, name, interval_value, interval_unit, provider_id) values (%L, %L, 'X', 1, 'dias', %L) $$,
  current_setting('t.ha'), current_setting('t.pet_a'), current_setting('t.pr_b')), '23503', null, 'FK: cuidado com prestador de B recusado (insert)');
select throws_ok(format($$ insert into public.casa_pet_care_log (household_id, care_id, done_on) values (%L, %L, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.care_b')), '23503', null, 'FK: histórico com cuidado de B recusado');
select throws_ok(format($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (%L, %L, '2026-11-02', 10) $$,
  current_setting('t.ha'), current_setting('t.pet_b')), '23503', null, 'FK: peso com pet de B recusado');
select throws_ok(format($$ insert into public.casa_pet_food (household_id, pet_id, brand, bag_kg, started_on) values (%L, %L, 'X', 1, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.pet_b')), '23503', null, 'FK: ração com pet de B recusada');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok(format($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (%L, %L, '2026-11-02', 10) $$,
  current_setting('t.hb'), current_setting('t.pet_a')), '23503', null, 'FK: B não registra peso em pet de A');
select throws_ok(format($$ update public.casa_pet_care set provider_id = %L where id = %L $$, current_setting('t.pr_a'), current_setting('t.care_b')),
  '23503', null, 'FK: B não liga cuidado a prestador de A');
select throws_ok(format($$ insert into public.casa_pet_care_log (household_id, care_id, done_on) values (%L, %L, '2026-11-01') $$,
  current_setting('t.hb'), current_setting('t.care_a')), '23503', null, 'FK: B não registra histórico em cuidado de A');

-- 9) Outra família: não lê, não insere, não altera, não apaga ----------------------------------------
select is((select count(*)::int from public.casa_pets where household_id = current_setting('t.ha')::uuid), 0, 'B não lê pets de A');
select is((select count(*)::int from public.casa_pet_health), 0, 'B não lê saúde de A');
select is((select count(*)::int from public.casa_pet_vet), 0, 'B não lê veterinário de A');
select is((select count(*)::int from public.casa_pet_care where household_id = current_setting('t.ha')::uuid), 0, 'B não lê cuidados de A');
select is((select count(*)::int from public.casa_pet_care_log), 0, 'B não lê histórico de A');
select is((select count(*)::int from public.casa_pet_weights), 0, 'B não lê pesos de A');
select is((select count(*)::int from public.casa_pet_food), 0, 'B não lê ração de A');

select throws_ok(format($$ insert into public.casa_pets (household_id, name) values (%L, 'X') $$, current_setting('t.ha')), '42501', null, 'B não insere pet em A');
select throws_ok(format($$ insert into public.casa_pet_health (household_id, pet_id, kind, name) values (%L, %L, 'vacina', 'X') $$,
  current_setting('t.ha'), current_setting('t.pet_a')), '42501', null, 'B não insere saúde em A');
select throws_ok(format($$ insert into public.casa_pet_vet (household_id, pet_id, kind, happened_on) values (%L, %L, 'consulta', '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.pet_a')), '42501', null, 'B não insere veterinário em A');
select throws_ok(format($$ insert into public.casa_pet_care (household_id, pet_id, name, interval_value, interval_unit) values (%L, %L, 'X', 1, 'dias') $$,
  current_setting('t.ha'), current_setting('t.pet_a')), '42501', null, 'B não insere cuidado em A');
select throws_ok(format($$ insert into public.casa_pet_care_log (household_id, care_id, done_on) values (%L, %L, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.care_a')), '42501', null, 'B não insere histórico em A');
select throws_ok(format($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (%L, %L, '2026-12-01', 10) $$,
  current_setting('t.ha'), current_setting('t.pet_a')), '42501', null, 'B não insere peso em A');
select throws_ok(format($$ insert into public.casa_pet_food (household_id, pet_id, brand, bag_kg, started_on) values (%L, %L, 'X', 1, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.pet_a')), '42501', null, 'B não insere ração em A');

select is_empty(format($$ update public.casa_pets set name = 'hack' where id = %L returning 1 $$, current_setting('t.pet_a')), 'B não altera pet de A');
select is_empty(format($$ update public.casa_pets set household_id = %L where id = %L returning 1 $$, current_setting('t.hb'), current_setting('t.pet_a')), 'B não move pet de A para B');
select is_empty(format($$ update public.casa_pet_health set name = 'hack' where id = %L returning 1 $$, current_setting('t.hl_a')), 'B não altera saúde de A');
select is_empty(format($$ update public.casa_pet_vet set notes = 'hack' where id = %L returning 1 $$, current_setting('t.vet_a')), 'B não altera veterinário de A');
select is_empty(format($$ update public.casa_pet_care set name = 'hack' where id = %L returning 1 $$, current_setting('t.care_a')), 'B não altera cuidado de A');
select is_empty(format($$ update public.casa_pet_care_log set notes = 'hack' where id = %L returning 1 $$, current_setting('t.log_a')), 'B não altera histórico de A');
select is_empty(format($$ update public.casa_pet_weights set weight_kg = 1 where id = %L returning 1 $$, current_setting('t.w_a')), 'B não altera peso de A');
select is_empty(format($$ update public.casa_pet_food set brand = 'hack' where id = %L returning 1 $$, current_setting('t.food_a')), 'B não altera ração de A');

select is_empty(format($$ delete from public.casa_pet_health where id = %L returning 1 $$, current_setting('t.hl_a')), 'B não apaga saúde de A');
select is_empty(format($$ delete from public.casa_pet_vet where id = %L returning 1 $$, current_setting('t.vet_a')), 'B não apaga veterinário de A');
select is_empty(format($$ delete from public.casa_pet_care_log where id = %L returning 1 $$, current_setting('t.log_a')), 'B não apaga histórico de A');
select is_empty(format($$ delete from public.casa_pet_care where id = %L returning 1 $$, current_setting('t.care_a')), 'B não apaga cuidado de A');
select is_empty(format($$ delete from public.casa_pet_weights where id = %L returning 1 $$, current_setting('t.w_a')), 'B não apaga peso de A');
select is_empty(format($$ delete from public.casa_pet_food where id = %L returning 1 $$, current_setting('t.food_a')), 'B não apaga ração de A');
select is_empty(format($$ delete from public.casa_pets where id = %L returning 1 $$, current_setting('t.pet_a')), 'B não apaga pet de A');
select lives_ok(format($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (%L, %L, '2026-11-01', 30) $$,
  current_setting('t.hb'), current_setting('t.pet_b')), 'B pesa o próprio pet no mesmo dia que A');

-- membro A move registro para B: barrado pelo with check -----------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok(format($$ update public.casa_pets set household_id = %L where id = %L $$, current_setting('t.hb'), current_setting('t.pet_a2')),
  '42501', null, 'A não move pet para B');

-- 10) updated_at -------------------------------------------------------------------------------------------
reset role;
update public.casa_pets set updated_at = '2000-01-01' where id = current_setting('t.pet_a')::uuid;
update public.casa_pet_health set updated_at = '2000-01-01' where id = current_setting('t.hl_a')::uuid;
update public.casa_pet_vet set updated_at = '2000-01-01' where id = current_setting('t.vet_a')::uuid;
update public.casa_pet_care set updated_at = '2000-01-01' where id = current_setting('t.care_a')::uuid;
update public.casa_pet_food set updated_at = '2000-01-01' where id = current_setting('t.food_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
update public.casa_pets set notes = 'Z' where id = current_setting('t.pet_a')::uuid;
update public.casa_pet_health set notes = 'Z' where id = current_setting('t.hl_a')::uuid;
update public.casa_pet_vet set notes = 'Z' where id = current_setting('t.vet_a')::uuid;
update public.casa_pet_care set notes = 'Z' where id = current_setting('t.care_a')::uuid;
update public.casa_pet_food set notes = 'Z' where id = current_setting('t.food_a')::uuid;
select ok((select updated_at > '2000-01-01' from public.casa_pets where id = current_setting('t.pet_a')::uuid), 'trigger atualiza updated_at (pets)');
select ok((select updated_at > '2000-01-01' from public.casa_pet_health where id = current_setting('t.hl_a')::uuid), 'trigger atualiza updated_at (saúde)');
select ok((select updated_at > '2000-01-01' from public.casa_pet_vet where id = current_setting('t.vet_a')::uuid), 'trigger atualiza updated_at (veterinário)');
select ok((select updated_at > '2000-01-01' from public.casa_pet_care where id = current_setting('t.care_a')::uuid), 'trigger atualiza updated_at (cuidados)');
select ok((select updated_at > '2000-01-01' from public.casa_pet_food where id = current_setting('t.food_a')::uuid), 'trigger atualiza updated_at (ração)');

-- 11) membro apaga; set null do prestador; cascades ------------------------------------------------------
select lives_ok(format($$ delete from public.casa_providers where id = %L $$, current_setting('t.pr_a')), 'A apaga prestador');
select is((select coalesce(provider_id::text, 'null') || '|' || household_id::text || '|' || pet_id::text from public.casa_pet_care where id = current_setting('t.care_a')::uuid),
  'null|' || current_setting('t.ha') || '|' || current_setting('t.pet_a'), 'cuidado fica sem provider_id; household_id e pet_id ficam');
select lives_ok(format($$ delete from public.casa_pet_care where id = %L $$, current_setting('t.care_a')), 'A apaga cuidado');
select is((select count(*)::int from public.casa_pet_care_log), 0, 'cascade: histórico do cuidado apagado');
select lives_ok(format($$ delete from public.casa_pets where id = %L $$, current_setting('t.pet_a')), 'A apaga pet');
select is((select (select count(*) from public.casa_pet_health) + (select count(*) from public.casa_pet_vet)
  + (select count(*) from public.casa_pet_food) + (select count(*) from public.casa_pet_weights where pet_id = current_setting('t.pet_a')::uuid))::int,
  0, 'cascade: saúde, veterinário, ração e pesos do pet apagados');
select is((select count(*)::int from public.casa_pet_weights where pet_id = current_setting('t.pet_a2')::uuid), 1, 'peso do outro pet continua');

-- 12) função de caminho (docs/ e pets/) -------------------------------------------------------------------
select is(public.casa_doc_path_household(current_setting('t.fa')), current_setting('t.ha')::uuid, 'pets/ .pdf válido retorna household');
select is(public.casa_doc_path_household(current_setting('t.fa2')), current_setting('t.ha')::uuid, 'pets/ .jpg válido retorna household');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/docs/11111111-1111-1111-1111-111111111111.pdf'), current_setting('t.ha')::uuid, 'docs/ continua aceito');
select is(public.casa_doc_path_household(upper(current_setting('t.ha')) || '/PETS/11111111-1111-1111-1111-111111111111.PDF'), current_setting('t.ha')::uuid, 'case-insensitive como em 0017');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/pets/11111111-1111-1111-1111-111111111111.png'), null, 'pets/ png => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/pet/11111111-1111-1111-1111-111111111111.pdf'), null, 'pasta pet (singular) => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/fotos/11111111-1111-1111-1111-111111111111.pdf'), null, 'pasta errada => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/docspets/11111111-1111-1111-1111-111111111111.pdf'), null, 'pasta concatenada => null');
select is(public.casa_doc_path_household('nao-e-uuid/pets/11111111-1111-1111-1111-111111111111.pdf'), null, 'household não-uuid => null sem erro de cast');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/pets/../' || current_setting('t.hb') || '/pets/11111111-1111-1111-1111-111111111111.pdf'), null, 'traversal => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/pets/x.pdf'), null, 'nome de arquivo não-uuid => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/pets/11111111-1111-1111-1111-111111111111.pdf/extra'), null, 'sufixo extra => null');
select is(public.casa_doc_path_household('/' || current_setting('t.ha') || '/pets/11111111-1111-1111-1111-111111111111.pdf'), null, 'barra inicial => null');
reset role;
select ok((select provolatile = 'i' and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.casa_doc_path_household(text)'::regprocedure),
  'casa_doc_path_household é immutable com search_path vazio');
select ok(not has_function_privilege('anon', 'public.casa_doc_path_household(text)', 'execute'), 'anon sem execute em casa_doc_path_household');
select ok(not has_function_privilege('public', 'public.casa_doc_path_household(text)', 'execute'), 'public sem execute em casa_doc_path_household');
select ok(has_function_privilege('authenticated', 'public.casa_doc_path_household(text)', 'execute'), 'authenticated executa casa_doc_path_household');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'casa: %'
  and roles = '{authenticated}' and coalesce(qual, with_check) like '%casa_doc_path_household(objects.name)%'), 4,
  'as 4 políticas do bucket casa continuam usando a função');

-- storage: pasta pets/ por família
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('casa', %L, %L) $$,
  current_setting('t.fa'), '00000000-0000-0000-0000-0000000000f1'), 'A envia arquivo para pets/ da própria família');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('casa', %L) $$, current_setting('t.fb')),
  '42501', null, 'A não envia arquivo para pets/ de B');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from storage.objects where bucket_id = 'casa' and name = current_setting('t.fa')), 1, 'cônjuge lê arquivo de pets/');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is((select count(*)::int from storage.objects where bucket_id = 'casa' and name = current_setting('t.fa')), 0, 'B não lê arquivo de pets/ de A');
select is_empty($$ update storage.objects set name = name where bucket_id = 'casa' returning 1 $$, 'B não altera arquivos de A');
reset role;

-- 13) anon ---------------------------------------------------------------------------------------------------
set local role anon;
select throws_ok(format('select count(*) from public.%I', t), '42501', null, 'anon não lê ' || t)
from unnest(array['casa_pets','casa_pet_health','casa_pet_vet','casa_pet_care','casa_pet_care_log',
  'casa_pet_weights','casa_pet_food']) as t;
select throws_ok($$ insert into public.casa_pets (household_id, name) values (gen_random_uuid(), 'X') $$, '42501', null, 'anon não insere pet');
select throws_ok($$ insert into public.casa_pet_weights (household_id, pet_id, measured_on, weight_kg) values (gen_random_uuid(), gen_random_uuid(), '2026-11-01', 1) $$, '42501', null, 'anon não insere peso');
select throws_ok($$ select public.casa_doc_path_household('x') $$, '42501', null, 'anon não executa casa_doc_path_household');
select is((select count(*)::int from storage.objects where bucket_id = 'casa'), 0, 'anon não lê arquivos do bucket');
reset role;
select ok(not has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated', 'public.' || t, 'truncate,references,trigger'),
  'grants corretos em ' || t)
from unnest(array['casa_pets','casa_pet_health','casa_pet_vet','casa_pet_care','casa_pet_care_log',
  'casa_pet_weights','casa_pet_food']) as t;

select * from finish();
rollback;
