-- Credencial Pluggy por item: coluna, default, check, not null e isolamento entre famílias.
begin;
select plan(13);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000026a1', 'pa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000026a2', 'pb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select has_column('public', 'fin_pluggy_items', 'credential', 'coluna credential existe');
select col_not_null('public', 'fin_pluggy_items', 'credential', 'credential é not null');
select col_default_is('public', 'fin_pluggy_items', 'credential', '''principal''::text', 'default é principal');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000026a1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000026a2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);

-- Membro de A: escreve com e sem credential
select pg_temp.as_user('00000000-0000-0000-0000-0000000026a1');
select lives_ok(format($$ insert into public.fin_pluggy_items (household_id, item_id, label)
  values (%L, '26000000-0000-0000-0000-000000000001', 'Sem credencial') $$, current_setting('t.ha')),
  'A insere item sem informar credential');
select is((select credential from public.fin_pluggy_items where item_id = '26000000-0000-0000-0000-000000000001'),
  'principal', 'linha sem credential fica principal (como as existentes na migração)');
select lives_ok(format($$ insert into public.fin_pluggy_items (household_id, item_id, label, credential)
  values (%L, '26000000-0000-0000-0000-000000000002', 'Da Karen', 'karen') $$, current_setting('t.ha')),
  'karen é aceito');
select throws_ok(format($$ insert into public.fin_pluggy_items (household_id, item_id, credential)
  values (%L, '26000000-0000-0000-0000-000000000003', 'xpto') $$, current_setting('t.ha')),
  '23514', null, 'valor fora da lista é rejeitado');
select throws_ok(format($$ insert into public.fin_pluggy_items (household_id, item_id, credential)
  values (%L, '26000000-0000-0000-0000-000000000004', null) $$, current_setting('t.ha')),
  '23502', null, 'null é rejeitado');
select throws_ok($$ update public.fin_pluggy_items set credential = 'xpto'
  where item_id = '26000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'update para valor inválido é rejeitado');

-- Família B: não lê, não insere, não altera, não apaga
select pg_temp.as_user('00000000-0000-0000-0000-0000000026a2');
select is((select count(*)::int from public.fin_pluggy_items where household_id = current_setting('t.ha')::uuid),
  0, 'B não lê itens de A');
select throws_ok(format($$ insert into public.fin_pluggy_items (household_id, item_id, credential)
  values (%L, '26000000-0000-0000-0000-000000000005', 'karen') $$, current_setting('t.ha')),
  '42501', null, 'B não insere item em A');
update public.fin_pluggy_items set credential = 'principal' where item_id = '26000000-0000-0000-0000-000000000002';
delete from public.fin_pluggy_items where household_id = current_setting('t.ha')::uuid;
reset role;
select is((select credential from public.fin_pluggy_items where item_id = '26000000-0000-0000-0000-000000000002'),
  'karen', 'B não altera nem apaga item de A');

-- anon não acessa
set local role anon;
select throws_ok($$ select count(*) from public.fin_pluggy_items $$, '42501', null, 'anon não lê fin_pluggy_items');
reset role;

select * from finish();
rollback;
