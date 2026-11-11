-- Casa parte 1: compras, tarefas (rodízio), manutenções — isolamento
-- por família, FKs compostas, trigger do rodízio, checks, updated_at e anon.
begin;
select plan(108);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'ca@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'cb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'cc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A: Ana (c1) + cônjuge Caio (c3). Família B: Bruno (c2).
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
select set_config('t.ma', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000c1'), true);
select set_config('t.mc', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000c3'), true);
select set_config('t.mb', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000c2'), true);
set local role authenticated;

-- B cria registros próprios (para testar FKs compostas cruzadas) ----------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into public.casa_chores (household_id, name, frequency) values (current_setting('t.hb')::uuid, 'Lixo B', 'diaria');
insert into public.casa_maintenance (household_id, name, interval_value, interval_unit) values (current_setting('t.hb')::uuid, 'Filtro B', 6, 'meses');
select set_config('t.ch_b', (select id::text from public.casa_chores), true);
select set_config('t.mt_b', (select id::text from public.casa_maintenance), true);

-- A: cria e lê -------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok(format($$ insert into public.casa_shopping_items (household_id, name, quantity, unit) values (%L, 'Arroz', 1, 'kg') $$,
  current_setting('t.ha')), 'A cria item de compra');
select set_config('t.sh_a', (select id::text from public.casa_shopping_items), true);
select lives_ok(format($$ insert into public.casa_chores (household_id, name, frequency, weekdays, rotation, next_index) values (%L, 'Louça', 'semanal', '{1,3,5}', array[%L, %L]::uuid[], 1) $$,
  current_setting('t.ha'), current_setting('t.ma'), current_setting('t.mc')), 'A cria tarefa semanal com rodízio');
select set_config('t.ch_a', (select id::text from public.casa_chores), true);
select lives_ok(format($$ insert into public.casa_chore_log (household_id, chore_id, member_id, done_on) values (%L, %L, %L, '2026-11-09') $$,
  current_setting('t.ha'), current_setting('t.ch_a'), current_setting('t.ma')), 'A registra tarefa feita');
select set_config('t.cl_a', (select id::text from public.casa_chore_log), true);
select lives_ok(format($$ insert into public.casa_maintenance (household_id, name, interval_value, interval_unit, provider) values (%L, 'Ar-condicionado', 6, 'meses', 'Técnico X') $$,
  current_setting('t.ha')), 'A cria manutenção');
select set_config('t.mt_a', (select id::text from public.casa_maintenance), true);
select lives_ok(format($$ insert into public.casa_maintenance_log (household_id, maintenance_id, done_on, cost) values (%L, %L, '2026-11-01', 150) $$,
  current_setting('t.ha'), current_setting('t.mt_a')), 'A registra manutenção feita');
select set_config('t.ml_a', (select id::text from public.casa_maintenance_log), true);

select is((select added_by from public.casa_shopping_items), '00000000-0000-0000-0000-0000000000c1'::uuid, 'added_by = auth.uid() por padrão');
select is((select done_by from public.casa_chore_log), '00000000-0000-0000-0000-0000000000c1'::uuid, 'chore_log.done_by = auth.uid() por padrão');
select is((select done_by from public.casa_maintenance_log), '00000000-0000-0000-0000-0000000000c1'::uuid, 'maintenance_log.done_by = auth.uid() por padrão');
select is((select done from public.casa_shopping_items), false, 'item de compra nasce não feito');
select is((select active from public.casa_chores), true, 'tarefa nasce ativa');

-- Cônjuge lê e altera (compartilhado) -------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select is((select count(*)::int from public.casa_shopping_items), 1, 'cônjuge lê compras');
select is((select count(*)::int from public.casa_chores), 1, 'cônjuge lê tarefas');
select is((select count(*)::int from public.casa_chore_log), 1, 'cônjuge lê histórico de tarefas');
select is((select count(*)::int from public.casa_maintenance), 1, 'cônjuge lê manutenções');
select is((select count(*)::int from public.casa_maintenance_log), 1, 'cônjuge lê histórico de manutenções');
select lives_ok(format($$ update public.casa_shopping_items set done = true, done_at = now() where id = %L $$, current_setting('t.sh_a')), 'cônjuge marca compra');
select lives_ok(format($$ update public.casa_chores set next_index = 0, next_due_on = '2026-11-11' where id = %L $$, current_setting('t.ch_a')), 'cônjuge avança rodízio');
select lives_ok(format($$ update public.casa_chore_log set done_on = '2026-11-08' where id = %L $$, current_setting('t.cl_a')), 'cônjuge altera histórico de tarefa');
select lives_ok(format($$ update public.casa_maintenance set last_done_on = '2026-11-01', next_due_on = '2027-05-01' where id = %L $$, current_setting('t.mt_a')), 'cônjuge altera manutenção');
select lives_ok(format($$ update public.casa_maintenance_log set cost = 200 where id = %L $$, current_setting('t.ml_a')), 'cônjuge altera histórico de manutenção');

-- B: não lê, não insere, não altera, não apaga --------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.casa_shopping_items), 0, 'B não lê compras de A');
select is((select count(*)::int from public.casa_chores where household_id = current_setting('t.ha')::uuid), 0, 'B não lê tarefas de A');
select is((select count(*)::int from public.casa_chore_log), 0, 'B não lê histórico de tarefas de A');
select is((select count(*)::int from public.casa_maintenance where household_id = current_setting('t.ha')::uuid), 0, 'B não lê manutenções de A');
select is((select count(*)::int from public.casa_maintenance_log), 0, 'B não lê histórico de manutenções de A');

select throws_ok(format($$ insert into public.casa_shopping_items (household_id, name) values (%L, 'X') $$, current_setting('t.ha')), '42501', null, 'B não insere compra em A');
select throws_ok(format($$ insert into public.casa_chores (household_id, name, frequency) values (%L, 'X', 'diaria') $$, current_setting('t.ha')), '42501', null, 'B não insere tarefa em A');
select throws_ok(format($$ insert into public.casa_chore_log (household_id, chore_id, done_on) values (%L, %L, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.ch_a')), '42501', null, 'B não insere histórico de tarefa em A');
select throws_ok(format($$ insert into public.casa_maintenance (household_id, name, interval_value, interval_unit) values (%L, 'X', 1, 'dias') $$, current_setting('t.ha')), '42501', null, 'B não insere manutenção em A');
select throws_ok(format($$ insert into public.casa_maintenance_log (household_id, maintenance_id, done_on) values (%L, %L, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.mt_a')), '42501', null, 'B não insere histórico de manutenção em A');

select is_empty(format($$ update public.casa_shopping_items set name = 'hack' where id = %L returning 1 $$, current_setting('t.sh_a')), 'B não altera compra de A');
select is_empty(format($$ update public.casa_chores set name = 'hack' where id = %L returning 1 $$, current_setting('t.ch_a')), 'B não altera tarefa de A');
select is_empty(format($$ update public.casa_chore_log set done_on = '2000-01-01' where id = %L returning 1 $$, current_setting('t.cl_a')), 'B não altera histórico de tarefa de A');
select is_empty(format($$ update public.casa_maintenance set name = 'hack' where id = %L returning 1 $$, current_setting('t.mt_a')), 'B não altera manutenção de A');
select is_empty(format($$ update public.casa_maintenance_log set cost = 0 where id = %L returning 1 $$, current_setting('t.ml_a')), 'B não altera histórico de manutenção de A');
select is_empty(format($$ update public.casa_chores set household_id = %L where id = %L returning 1 $$, current_setting('t.hb'), current_setting('t.ch_a')), 'B não move tarefa de A para B');

select is_empty(format($$ delete from public.casa_shopping_items where id = %L returning 1 $$, current_setting('t.sh_a')), 'B não apaga compra de A');
select is_empty(format($$ delete from public.casa_chores where id = %L returning 1 $$, current_setting('t.ch_a')), 'B não apaga tarefa de A');
select is_empty(format($$ delete from public.casa_chore_log where id = %L returning 1 $$, current_setting('t.cl_a')), 'B não apaga histórico de tarefa de A');
select is_empty(format($$ delete from public.casa_maintenance where id = %L returning 1 $$, current_setting('t.mt_a')), 'B não apaga manutenção de A');
select is_empty(format($$ delete from public.casa_maintenance_log where id = %L returning 1 $$, current_setting('t.ml_a')), 'B não apaga histórico de manutenção de A');

-- FKs compostas barram ids de outra família --------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok(format($$ insert into public.casa_chore_log (household_id, chore_id, done_on) values (%L, %L, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.ch_b')), '23503', null, 'FK composta: histórico com chore_id de B');
select throws_ok(format($$ insert into public.casa_chore_log (household_id, chore_id, member_id, done_on) values (%L, %L, %L, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.ch_a'), current_setting('t.mb')), '23503', null, 'FK composta: histórico com member_id de B');
select throws_ok(format($$ insert into public.casa_maintenance_log (household_id, maintenance_id, done_on) values (%L, %L, '2026-11-01') $$,
  current_setting('t.ha'), current_setting('t.mt_b')), '23503', null, 'FK composta: histórico com maintenance_id de B');

-- Trigger do rodízio -------------------------------------------------------------
select throws_ok(format($$ insert into public.casa_chores (household_id, name, frequency, rotation) values (%L, 'X', 'diaria', array[%L, %L]::uuid[]) $$,
  current_setting('t.ha'), current_setting('t.ma'), current_setting('t.mb')), '23503', null, 'rodízio recusa member de outra família (insert)');
select throws_ok(format($$ update public.casa_chores set rotation = array[%L]::uuid[], next_index = 0 where id = %L $$,
  current_setting('t.mb'), current_setting('t.ch_a')), '23503', null, 'rodízio recusa member de outra família (update)');
select throws_ok(format($$ insert into public.casa_chores (household_id, name, frequency, rotation) values (%L, 'X', 'diaria', array[gen_random_uuid()]) $$,
  current_setting('t.ha')), '23503', null, 'rodízio recusa id inexistente');
select throws_ok(format($$ insert into public.casa_chores (household_id, name, frequency, rotation) values (%L, 'X', 'diaria', array[null]::uuid[]) $$,
  current_setting('t.ha')), '23503', null, 'rodízio recusa id nulo');
select throws_ok(format($$ update public.casa_chores set next_index = 2 where id = %L $$, current_setting('t.ch_a')), '23514', null, 'next_index = cardinality é recusado');
select throws_ok(format($$ update public.casa_chores set next_index = -1 where id = %L $$, current_setting('t.ch_a')), '23514', null, 'next_index negativo é recusado');
select lives_ok(format($$ update public.casa_chores set next_index = 1 where id = %L $$, current_setting('t.ch_a')), 'next_index dentro do rodízio aceito');
select lives_ok(format($$ insert into public.casa_chores (household_id, name, frequency, rotation) values (%L, 'Cama', 'diaria', array[%L, %L, %L]::uuid[]) $$,
  current_setting('t.ha'), current_setting('t.ma'), current_setting('t.mc'), current_setting('t.ma')), 'rodízio pode repetir pessoa da família');
select throws_ok(format($$ insert into public.casa_chores (household_id, name, frequency, rotation) values (%L, 'X', 'diaria', array_fill(%L::uuid, array[11])) $$,
  current_setting('t.ha'), current_setting('t.ma')), '23514', null, 'rodízio com mais de 10 posições recusado');
select lives_ok(format($$ insert into public.casa_chores (household_id, name, frequency) values (%L, 'Sem rodízio', 'mensal') $$,
  current_setting('t.ha')), 'tarefa sem rodízio aceita');

-- Checks -------------------------------------------------------------------------
select throws_ok(format($$ update public.casa_chores set frequency = 'anual', weekdays = null where id = %L $$, current_setting('t.ch_a')), '23514', null, 'frequency fora da lista');
select throws_ok(format($$ update public.casa_chores set weekdays = '{7}' where id = %L $$, current_setting('t.ch_a')), '23514', null, 'weekdays com 7');
select throws_ok(format($$ update public.casa_chores set weekdays = '{-1}' where id = %L $$, current_setting('t.ch_a')), '23514', null, 'weekdays negativo');
select throws_ok(format($$ update public.casa_chores set weekdays = '{1,1}' where id = %L $$, current_setting('t.ch_a')), '23514', null, 'weekdays repetido');
select throws_ok(format($$ update public.casa_chores set weekdays = '{}' where id = %L $$, current_setting('t.ch_a')), '23514', null, 'weekdays vazio');
select throws_ok(format($$ update public.casa_chores set weekdays = '{1,null}' where id = %L $$, current_setting('t.ch_a')), '23514', null, 'weekdays com nulo');
select throws_ok(format($$ update public.casa_chores set frequency = 'diaria' where id = %L $$, current_setting('t.ch_a')), '23514', null, 'weekdays só em semanal');
select lives_ok(format($$ update public.casa_chores set weekdays = '{0,6}' where id = %L $$, current_setting('t.ch_a')), 'weekdays domingo e sábado aceitos');
select throws_ok(format($$ update public.casa_chores set month_day = 10 where id = %L $$, current_setting('t.ch_a')), '23514', null, 'month_day só em mensal');
select throws_ok(format($$ update public.casa_chores set frequency = 'mensal', weekdays = null, month_day = 0 where id = %L $$, current_setting('t.ch_a')), '23514', null, 'month_day 0');
select throws_ok(format($$ update public.casa_chores set frequency = 'mensal', weekdays = null, month_day = 32 where id = %L $$, current_setting('t.ch_a')), '23514', null, 'month_day 32');
select lives_ok(format($$ update public.casa_chores set frequency = 'mensal', weekdays = null, month_day = 31 where id = %L $$, current_setting('t.ch_a')), 'month_day 31 em mensal aceito');
select throws_ok(format($$ update public.casa_chores set name = '' where id = %L $$, current_setting('t.ch_a')), '23514', null, 'tarefa: nome vazio');
select throws_ok(format($$ update public.casa_chores set name = repeat('x', 121) where id = %L $$, current_setting('t.ch_a')), '23514', null, 'tarefa: nome acima de 120');
select throws_ok(format($$ update public.casa_chores set notes = repeat('x', 501) where id = %L $$, current_setting('t.ch_a')), '23514', null, 'tarefa: notes acima de 500');

select throws_ok(format($$ update public.casa_maintenance set interval_value = 0 where id = %L $$, current_setting('t.mt_a')), '23514', null, 'manutenção: intervalo 0');
select throws_ok(format($$ update public.casa_maintenance set interval_value = 366 where id = %L $$, current_setting('t.mt_a')), '23514', null, 'manutenção: intervalo 366');
select throws_ok(format($$ update public.casa_maintenance set interval_unit = 'horas' where id = %L $$, current_setting('t.mt_a')), '23514', null, 'manutenção: unidade fora da lista');
select throws_ok(format($$ update public.casa_maintenance set name = repeat('x', 121) where id = %L $$, current_setting('t.mt_a')), '23514', null, 'manutenção: nome acima de 120');
select throws_ok(format($$ update public.casa_maintenance set provider = repeat('x', 121) where id = %L $$, current_setting('t.mt_a')), '23514', null, 'manutenção: provider acima de 120');
select throws_ok(format($$ update public.casa_maintenance set notes = repeat('x', 501) where id = %L $$, current_setting('t.mt_a')), '23514', null, 'manutenção: notes acima de 500');
select throws_ok(format($$ update public.casa_maintenance_log set cost = -1 where id = %L $$, current_setting('t.ml_a')), '23514', null, 'histórico: custo negativo');
select throws_ok(format($$ update public.casa_maintenance_log set notes = repeat('x', 501) where id = %L $$, current_setting('t.ml_a')), '23514', null, 'histórico: notes acima de 500');

select throws_ok(format($$ update public.casa_shopping_items set quantity = 0 where id = %L $$, current_setting('t.sh_a')), '23514', null, 'compra: quantidade 0');
select lives_ok(format($$ update public.casa_shopping_items set quantity = null where id = %L $$, current_setting('t.sh_a')), 'compra: quantidade nula aceita');
select throws_ok(format($$ update public.casa_shopping_items set name = repeat('x', 121) where id = %L $$, current_setting('t.sh_a')), '23514', null, 'compra: nome acima de 120');
select throws_ok(format($$ update public.casa_shopping_items set unit = repeat('x', 21) where id = %L $$, current_setting('t.sh_a')), '23514', null, 'compra: unit acima de 20');
select throws_ok(format($$ update public.casa_shopping_items set category = repeat('x', 41) where id = %L $$, current_setting('t.sh_a')), '23514', null, 'compra: category acima de 40');
select throws_ok(format($$ update public.casa_shopping_items set notes = repeat('x', 301) where id = %L $$, current_setting('t.sh_a')), '23514', null, 'compra: notes acima de 300');

-- Despensa removida na 0017 (casa_pantry_items, pantry_item_id e o índice único
-- parcial não existem mais): itens com o mesmo nome continuam permitidos.
select lives_ok(format($$ insert into public.casa_shopping_items (household_id, name) values (%L, 'Pão'), (%L, 'Pão') $$,
  current_setting('t.ha'), current_setting('t.ha')), 'itens repetidos na lista são aceitos');

-- Member apagado que continua no rodízio ----------------------------------------
reset role;
insert into public.members (household_id, name, relation) values (current_setting('t.ha')::uuid, 'Dependente', 'filho');
select set_config('t.md', (select id::text from public.members where name = 'Dependente'), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into public.casa_chores (household_id, name, frequency, rotation)
  values (current_setting('t.ha')::uuid, 'Varrer', 'diaria', array[current_setting('t.ma'), current_setting('t.md')]::uuid[]);
select set_config('t.ch_v', (select id::text from public.casa_chores where name = 'Varrer'), true);
reset role;
delete from public.members where id = current_setting('t.md')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select ok((select current_setting('t.md')::uuid = any(rotation) from public.casa_chores where id = current_setting('t.ch_v')::uuid),
  'member apagado continua em rotation');
select lives_ok(format($$ update public.casa_chores set next_index = 1, next_due_on = '2026-11-12' where id = %L $$, current_setting('t.ch_v')),
  'avançar next_index sem mudar rotation funciona com member apagado');
select throws_ok(format($$ update public.casa_chores set rotation = array[%L, %L, %L]::uuid[] where id = %L $$,
  current_setting('t.ma'), current_setting('t.md'), current_setting('t.mc'), current_setting('t.ch_v')), '23503', null,
  'mudar rotation mantendo o id apagado é recusado');
select lives_ok(format($$ update public.casa_chores set rotation = array[%L, %L]::uuid[], next_index = 0 where id = %L $$,
  current_setting('t.ma'), current_setting('t.mc'), current_setting('t.ch_v')), 'trocar o id apagado por member válido funciona');

-- trigger updated_at -----------------------------------------------------------
reset role;
update public.casa_shopping_items set updated_at = '2000-01-01' where id = current_setting('t.sh_a')::uuid;
update public.casa_chores set updated_at = '2000-01-01' where id = current_setting('t.ch_a')::uuid;
update public.casa_maintenance set updated_at = '2000-01-01' where id = current_setting('t.mt_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
update public.casa_shopping_items set notes = 'Z' where id = current_setting('t.sh_a')::uuid;
update public.casa_chores set notes = 'Z' where id = current_setting('t.ch_a')::uuid;
update public.casa_maintenance set notes = 'Z' where id = current_setting('t.mt_a')::uuid;
select ok((select updated_at > '2000-01-01' from public.casa_shopping_items where id = current_setting('t.sh_a')::uuid), 'trigger atualiza updated_at (compras)');
select ok((select updated_at > '2000-01-01' from public.casa_chores where id = current_setting('t.ch_a')::uuid), 'trigger atualiza updated_at (tarefas)');
select ok((select updated_at > '2000-01-01' from public.casa_maintenance where id = current_setting('t.mt_a')::uuid), 'trigger atualiza updated_at (manutenções)');

-- apagar (membro) e efeitos das FKs ------------------------------------------------
select lives_ok(format($$ delete from public.casa_shopping_items where id = %L $$, current_setting('t.sh_a')), 'A apaga compra');
select lives_ok(format($$ delete from public.casa_chores where id = %L $$, current_setting('t.ch_a')), 'A apaga tarefa');
select is((select count(*)::int from public.casa_chore_log), 0, 'histórico da tarefa apagado em cascata');
select lives_ok(format($$ delete from public.casa_maintenance_log where id = %L $$, current_setting('t.ml_a')), 'A apaga histórico de manutenção');
select lives_ok(format($$ delete from public.casa_maintenance where id = %L $$, current_setting('t.mt_a')), 'A apaga manutenção');

-- anon ----------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.casa_shopping_items $$, '42501', null, 'anon não lê compras');
select throws_ok($$ select count(*) from public.casa_chores $$, '42501', null, 'anon não lê tarefas');
select throws_ok($$ select count(*) from public.casa_chore_log $$, '42501', null, 'anon não lê histórico de tarefas');
select throws_ok($$ select count(*) from public.casa_maintenance $$, '42501', null, 'anon não lê manutenções');
select throws_ok($$ select count(*) from public.casa_maintenance_log $$, '42501', null, 'anon não lê histórico de manutenções');
reset role;
select ok(not has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.' || t, 'truncate,references,trigger'),
  'grants corretos em ' || t)
from unnest(array['casa_shopping_items','casa_chores','casa_chore_log',
  'casa_maintenance','casa_maintenance_log']) as t;
select ok(not has_function_privilege('authenticated', 'public.casa_touch()', 'execute')
  and not has_function_privilege('anon', 'public.casa_chores_check()', 'execute'),
  'funções de trigger sem execute para anon/authenticated');

-- 00_helpers: todas as tabelas casa_* com RLS
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'casa\_%' and not c.relrowsecurity $$,
  'tabelas casa_* com RLS ligado');

select * from finish();
rollback;
