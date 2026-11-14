-- 0024: igreja_carisma_files aceita text/plain; mime fora da lista segue rejeitado;
-- RLS inalterada (outra família não lê, não insere, não altera, não apaga; anon nada).
begin;
select plan(13);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'ta@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'tb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;

insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
select m.household_id, m.id, 'sub-' || m.name, lower(m.name) || '@gmail.test', 'v1.iv.c.t', 'drive.file'
from public.members m where m.user_id in ('00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2');
select set_config('t.acc_a', (select id::text from public.google_accounts where google_sub = 'sub-Ana' and household_id = current_setting('t.ha')::uuid), true);

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.igreja_carisma_lessons (household_id, title) values (current_setting('t.ha')::uuid, 'Aula A');
select set_config('t.les_a', (select id::text from public.igreja_carisma_lessons where household_id = current_setting('t.ha')::uuid), true);

select lives_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'txt1', 'text/plain', 20971520, 'notas.txt') $$,
  current_setting('t.ha'), current_setting('t.les_a'), current_setting('t.acc_a')), 'dono anexa text/plain (20 MB)');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'html1', 'text/html', 10, 'x.html') $$,
  current_setting('t.ha'), current_setting('t.les_a'), current_setting('t.acc_a')), '23514', null, 'text/html segue rejeitado');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'txt2', 'text/plain', 20971521, 'grande.txt') $$,
  current_setting('t.ha'), current_setting('t.les_a'), current_setting('t.acc_a')), '23514', null, 'text/plain acima de 20 MB rejeitado');
select lives_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'pdf1', 'application/pdf', 10, 'a.pdf') $$,
  current_setting('t.ha'), current_setting('t.les_a'), current_setting('t.acc_a')), 'pdf continua aceito');
select throws_ok(format($$ update public.igreja_carisma_files set file_mime = 'text/csv' where drive_file_id = 'txt1' $$),
  '23514', null, 'update para mime fora da lista rejeitado');
select is((select count(*)::int from public.igreja_carisma_files where lesson_id = current_setting('t.les_a')::uuid and file_mime = 'text/plain'), 1, 'dono lê o text/plain');

-- Outra família (Bruno)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.igreja_carisma_files where lesson_id = current_setting('t.les_a')::uuid), 0, 'outra família não lê arquivos de A');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'inv1', 'text/plain', 10, 'inv.txt') $$,
  current_setting('t.ha'), current_setting('t.les_a'), current_setting('t.acc_a')), '42501', null, 'outra família não insere em A');
select is_empty($$ update public.igreja_carisma_files set display_name = 'hack' returning 1 $$, 'outra família não altera');
select is_empty($$ delete from public.igreja_carisma_files returning 1 $$, 'outra família não apaga');

-- anon
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.igreja_carisma_files $$, '42501', null, 'anon não lê');

reset role;
select is((select count(*)::int from public.igreja_carisma_files where lesson_id = current_setting('t.les_a')::uuid), 2, 'nada foi alterado/apagado por outra família');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'igreja_carisma_files' and roles = '{authenticated}'), 4, 'RLS: 4 políticas to authenticated seguem');

select * from finish();
rollback;
