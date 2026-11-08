-- Conexões Pluggy: isolamento, item único e vínculo de contas.
begin;
select plan(8);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'oa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'ob@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);

select lives_ok(format($$ insert into public.fin_pluggy_items (household_id, item_id, label)
  values (%L, 'aaaaaaaa-0000-0000-0000-000000000001', 'Nubank') $$, current_setting('t.hb')), 'B conecta um item');
reset role;
select set_config('t.item_b', (select id::text from public.fin_pluggy_items where household_id = current_setting('t.hb')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select lives_ok(format($$ insert into public.fin_accounts (household_id, name, kind, external_id, pluggy_item_ref, sync_from)
  values (%L, 'Nubank', 'corrente', 'acc-1', %L, '2026-11-01') $$, current_setting('t.hb'), current_setting('t.item_b')),
  'B vincula conta ao item');
select throws_ok(format($$ insert into public.fin_accounts (household_id, name, kind, external_id) values (%L, 'Dup', 'corrente', 'acc-1') $$,
  current_setting('t.hb')), '23505', null, 'mesma conta da Pluggy não vincula duas contas');

-- A: não vê o item de B, não cadastra o mesmo itemId e não liga conta ao item de B
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.fin_pluggy_items where household_id = current_setting('t.hb')::uuid), 0, 'A não vê conexões de B');
select throws_ok(format($$ insert into public.fin_pluggy_items (household_id, item_id) values (%L, 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  current_setting('t.ha')), '23505', null, 'itemId já usado não pode ser cadastrado por outra família');
select throws_ok(format($$ insert into public.fin_accounts (household_id, name, kind, pluggy_item_ref) values (%L, 'X', 'corrente', %L) $$,
  current_setting('t.ha'), current_setting('t.item_b')), '23503', null, 'A não liga conta ao item de B');
update public.fin_pluggy_items set item_id = 'bbbbbbbb-0000-0000-0000-000000000002' where household_id = current_setting('t.hb')::uuid;
reset role;
select is((select item_id::text from public.fin_pluggy_items where id = current_setting('t.item_b')::uuid),
  'aaaaaaaa-0000-0000-0000-000000000001', 'A não altera o item de B');
set local role authenticated;

-- Remover a conexão desfaz o vínculo e mantém a conta
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
delete from public.fin_pluggy_items where id = current_setting('t.item_b')::uuid;
reset role;
select is((select pluggy_item_ref from public.fin_accounts where external_id = 'acc-1'), null, 'conta continua, sem vínculo');

select * from finish();
rollback;
