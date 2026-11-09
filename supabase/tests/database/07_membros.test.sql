-- members: vínculo com login (user_id), família e id travados para o app (0008).
-- Titular e cônjuge só entram por create_household/join_household.
begin;
select plan(13);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'da@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'dc@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'dx@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- create e join continuam funcionando
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$ select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true) $$, 'create_household funciona');
reset role;
select set_config('t.code', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select lives_ok($$ select public.join_household(current_setting('t.code'), 'Caio') $$, 'join_household funciona');
reset role;
select is((select string_agg(relation, ',' order by relation) from public.members
  where household_id = current_setting('t.ha')::uuid and user_id is not null), 'conjuge,titular',
  'create e join criam titular e cônjuge com login');
select set_config('t.ma', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000d1'), true);
select set_config('t.mc', (select id::text from public.members where user_id = '00000000-0000-0000-0000-0000000000d2'), true);
set local role authenticated;

-- cônjuge (Caio) não troca user_id do outro nem o próprio, nem household_id/id
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok(format($$ update public.members set user_id = null where id = %L $$, current_setting('t.ma')),
  '42501', null, 'cônjuge não muda user_id do outro');
select throws_ok(format($$ update public.members set user_id = '00000000-0000-0000-0000-0000000000d1' where id = %L $$, current_setting('t.mc')),
  '42501', null, 'cônjuge não muda o próprio user_id');
select throws_ok(format($$ update public.members set household_id = gen_random_uuid() where id = %L $$, current_setting('t.mc')),
  '42501', null, 'household_id de membro é imutável');
select throws_ok(format($$ update public.members set id = gen_random_uuid() where id = %L $$, current_setting('t.mc')),
  '42501', null, 'id de membro é imutável');

-- campos editáveis continuam editáveis
select lives_ok(format($$ update public.members set name = 'Ana Maria', birth_date = '1990-01-01', color = '#112233' where id = %L $$,
  current_setting('t.ma')), 'cônjuge edita nome, nascimento e cor');
reset role;
select is((select name from public.members where id = current_setting('t.ma')::uuid), 'Ana Maria', 'nome editado foi gravado');
set local role authenticated;

-- insert: ninguém cria membro com user_id de alguém
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok(format($$ insert into public.members (household_id, user_id, name) values (%L, '00000000-0000-0000-0000-0000000000d3', 'Xavier') $$,
  current_setting('t.ha')), '42501', null, 'não cria membro com user_id de outra pessoa');
select throws_ok(format($$ insert into public.members (household_id, user_id, name) values (%L, '00000000-0000-0000-0000-0000000000d2', 'Caio 2') $$,
  current_setting('t.ha')), '42501', null, 'não cria membro com o próprio user_id');

-- dependente continua funcionando (mesmo payload do app: familia/actions.ts)
select lives_ok(format($$ insert into public.members (household_id, name, relation, birth_date, color)
  values (%L, 'Theo', 'filho', '2022-05-01', '#C08A3E') $$, current_setting('t.ha')), 'cria dependente sem login');
reset role;
select is((select user_id from public.members where name = 'Theo'), null, 'dependente fica sem user_id');

select * from finish();
rollback;
