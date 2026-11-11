-- Casa: foto do pet (casa_pets.photo_*): colunas, tudo-ou-nada, mime/size,
-- caminho preso à família do registro, isolamento entre famílias e anon.
begin;
select plan(42);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'pa@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'pb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'pc@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A: Ana (a1) + Caio (a3). Família B: Bruno (a2).
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

select set_config('t.pa', current_setting('t.ha') || '/pets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', true);
select set_config('t.pa2', current_setting('t.ha') || '/pets/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg', true);
select set_config('t.pb', current_setting('t.hb') || '/pets/cccccccc-cccc-cccc-cccc-cccccccccccc.jpg', true);

-- estrutura -------------------------------------------------------------------------
select has_column('public', 'casa_pets', c, 'coluna ' || c) from unnest(array['photo_path','photo_mime','photo_size']) as c;
select col_is_null('public', 'casa_pets', c, c || ' é opcional') from unnest(array['photo_path','photo_mime','photo_size']) as c;
select has_check('public', 'casa_pets', 'tem checks');
select is((select count(*)::int from pg_constraint where conrelid = 'public.casa_pets'::regclass
  and conname in ('casa_pets_photo_all_or_none','casa_pets_photo_path_household')), 2, 'constraints da foto existem');
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$, 'todas as tabelas de public têm RLS ligado');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'casa_pets'
  and roles = '{authenticated}' and coalesce(qual, with_check) like '%is_household_member(casa_pets.household_id)%'), 4,
  'casa_pets continua com 4 políticas por família');
select is((select allowed_mime_types::text || '|' || file_size_limit::text from storage.buckets where id = 'casa'),
  '{application/pdf,image/jpeg}|5242880', 'bucket casa aceita image/jpeg e 5 MB');

-- membro cria e atualiza foto ---------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$ insert into public.casa_pets (household_id, name) values (%L, 'Moisés') $$, current_setting('t.ha')), 'A cria pet sem foto');
select set_config('t.pet_a', (select id::text from public.casa_pets), true);
select is((select photo_path is null and photo_mime is null and photo_size is null from public.casa_pets), true, 'pet nasce sem foto');
select lives_ok(format($$ update public.casa_pets set photo_path = %L, photo_mime = 'image/jpeg', photo_size = 123456 where id = %L $$,
  current_setting('t.pa'), current_setting('t.pet_a')), 'A grava foto válida');
select lives_ok(format($$ insert into public.casa_pets (household_id, name, photo_path, photo_mime, photo_size) values (%L, 'Mia', %L, 'image/jpeg', 5242880) $$,
  current_setting('t.ha'), current_setting('t.pa2')), 'A cria pet já com foto de 5 MB');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select photo_path from public.casa_pets where id = current_setting('t.pet_a')::uuid), current_setting('t.pa'), 'cônjuge lê a foto');
select lives_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$, current_setting('t.pa2'), current_setting('t.pet_a')),
  'cônjuge troca o caminho da foto');
select lives_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$, current_setting('t.pa'), current_setting('t.pet_a')),
  'cônjuge volta o caminho');

-- tudo-ou-nada -----------------------------------------------------------------------
select throws_ok(format($$ update public.casa_pets set photo_path = null where id = %L $$, current_setting('t.pet_a')), '23514', null, 'tudo-ou-nada: só sem path');
select throws_ok(format($$ update public.casa_pets set photo_mime = null where id = %L $$, current_setting('t.pet_a')), '23514', null, 'tudo-ou-nada: só sem mime');
select throws_ok(format($$ update public.casa_pets set photo_size = null where id = %L $$, current_setting('t.pet_a')), '23514', null, 'tudo-ou-nada: só sem size');
select throws_ok(format($$ insert into public.casa_pets (household_id, name, photo_path) values (%L, 'X', %L) $$,
  current_setting('t.ha'), current_setting('t.pa')), '23514', null, 'tudo-ou-nada: insert só com path');
select throws_ok(format($$ insert into public.casa_pets (household_id, name, photo_mime, photo_size) values (%L, 'X', 'image/jpeg', 10) $$,
  current_setting('t.ha')), '23514', null, 'tudo-ou-nada: insert sem path');

-- mime / size / path -------------------------------------------------------------------
select throws_ok(format($$ update public.casa_pets set photo_mime = 'image/png' where id = %L $$, current_setting('t.pet_a')), '23514', null, 'mime png recusado');
select throws_ok(format($$ update public.casa_pets set photo_mime = 'application/pdf' where id = %L $$, current_setting('t.pet_a')), '23514', null, 'mime pdf recusado');
select throws_ok(format($$ update public.casa_pets set photo_size = 0 where id = %L $$, current_setting('t.pet_a')), '23514', null, 'size 0 recusado');
select throws_ok(format($$ update public.casa_pets set photo_size = 5242881 where id = %L $$, current_setting('t.pet_a')), '23514', null, 'size acima de 5 MB recusado');
select throws_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$, repeat('x', 301), current_setting('t.pet_a')), '23514', null, 'path acima de 300 recusado');
select throws_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$, current_setting('t.pb'), current_setting('t.pet_a')),
  '23514', null, 'caminho da família B recusado em pet de A');
select throws_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$,
  current_setting('t.ha') || '/docs/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', current_setting('t.pet_a')), '23514', null, 'pasta docs/ recusada');
select throws_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$,
  current_setting('t.ha') || '/pets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf', current_setting('t.pet_a')), '23514', null, 'extensão pdf recusada');
select throws_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$,
  current_setting('t.ha') || '/pets/../' || current_setting('t.hb') || '/pets/cccccccc-cccc-cccc-cccc-cccccccccccc.jpg', current_setting('t.pet_a')),
  '23514', null, 'traversal recusado');
select throws_ok(format($$ update public.casa_pets set photo_path = %L where id = %L $$,
  current_setting('t.ha') || '/pets/x.jpg', current_setting('t.pet_a')), '23514', null, 'nome não-uuid recusado');
select lives_ok(format($$ update public.casa_pets set photo_path = null, photo_mime = null, photo_size = null where id = %L $$, current_setting('t.pet_a')),
  'remover os três juntos é aceito');

-- outra família (B) ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.casa_pets where household_id = current_setting('t.ha')::uuid), 0, 'B não lê pets (nem fotos) de A');
select throws_ok(format($$ insert into public.casa_pets (household_id, name, photo_path, photo_mime, photo_size) values (%L, 'X', %L, 'image/jpeg', 10) $$,
  current_setting('t.ha'), current_setting('t.pa')), '42501', null, 'B não insere pet com foto em A');
select is_empty(format($$ update public.casa_pets set photo_path = %L, photo_mime = 'image/jpeg', photo_size = 1 where id = %L returning 1 $$,
  current_setting('t.pb'), current_setting('t.pet_a')), 'B não altera foto de pet de A');
select is_empty(format($$ delete from public.casa_pets where id = %L returning 1 $$, current_setting('t.pet_a')), 'B não apaga pet de A');
select lives_ok(format($$ insert into public.casa_pets (household_id, name, photo_path, photo_mime, photo_size) values (%L, 'Rex B', %L, 'image/jpeg', 10) $$,
  current_setting('t.hb'), current_setting('t.pb')), 'B grava foto no próprio pet');
select throws_ok(format($$ update public.casa_pets set photo_path = %L where household_id = %L $$, current_setting('t.pa'), current_setting('t.hb')),
  '23514', null, 'B não aponta o próprio pet para arquivo de A');
reset role;

-- anon ---------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select photo_path from public.casa_pets $$, '42501', null, 'anon não lê foto do pet');
select throws_ok($$ update public.casa_pets set photo_size = 1 $$, '42501', null, 'anon não altera foto do pet');
reset role;

select * from finish();
rollback;
