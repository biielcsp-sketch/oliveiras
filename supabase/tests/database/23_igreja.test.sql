-- Igreja: igreja_words, igreja_prayers, igreja_purposes, igreja_carisma_lessons,
-- igreja_carisma_files e google_drive_folders. Dados PESSOAIS: dono lê/escreve; cônjuge
-- só LÊ o que foi compartilhado; outra família não vê nada; anon nada. owner_id não
-- pode ser forjado; checks; arquivos seguem a aula e exigem conta Google do próprio usuário.
begin;
select plan(186);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'ia@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'ib@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'ic@teste.invalid', 'authenticated', 'authenticated');

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

select set_config('t.ana', '00000000-0000-0000-0000-0000000000f1', true);
select set_config('t.bru', '00000000-0000-0000-0000-0000000000f2', true);
select set_config('t.cai', '00000000-0000-0000-0000-0000000000f3', true);

-- Contas Google (preparadas como superusuário; a RLS de google_accounts é testada em 06)
insert into public.google_accounts (household_id, member_id, google_sub, email, token_ciphertext, scopes)
select m.household_id, m.id, 'sub-' || m.name, lower(m.name) || '@gmail.test', 'v1.iv.c.t', 'drive.file'
from public.members m where m.user_id in ('00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3');
select set_config('t.acc_a', (select id::text from public.google_accounts where google_sub = 'sub-Ana'), true);
select set_config('t.acc_b', (select id::text from public.google_accounts where google_sub = 'sub-Bruno'), true);
select set_config('t.acc_c', (select id::text from public.google_accounts where google_sub = 'sub-Caio'), true);

-- 00_helpers / estrutura -------------------------------------------------------------------
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'todas as tabelas de public (inclusive as novas) têm RLS ligado');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = t
  and roles = '{authenticated}'), 4, '4 políticas to authenticated em ' || t)
from unnest(array['igreja_words','igreja_prayers','igreja_purposes','igreja_carisma_lessons',
  'igreja_carisma_files','google_drive_folders']) as t;
select has_index('public', t, i, 'índice ' || i)
from (values ('igreja_words','igreja_words_owner_idx'), ('igreja_words','igreja_words_household_idx'),
             ('igreja_prayers','igreja_prayers_owner_idx'), ('igreja_prayers','igreja_prayers_household_idx'),
             ('igreja_purposes','igreja_purposes_owner_idx'), ('igreja_purposes','igreja_purposes_household_idx'),
             ('igreja_carisma_lessons','igreja_carisma_lessons_owner_idx'),
             ('igreja_carisma_lessons','igreja_carisma_lessons_household_idx'),
             ('igreja_carisma_files','igreja_carisma_files_lesson_idx'),
             ('igreja_carisma_files','igreja_carisma_files_account_idx'),
             ('igreja_carisma_files','igreja_carisma_files_household_idx'),
             ('igreja_carisma_files','igreja_carisma_files_owner_idx'),
             ('google_drive_folders','google_drive_folders_account_idx'),
             ('google_drive_folders','google_drive_folders_household_idx')) as x(t, i);
select ok(not has_function_privilege('authenticated', 'public.igreja_touch()', 'execute'), 'authenticated sem execute em igreja_touch');
select ok(not exists (select 1 from storage.buckets where id = 'igreja'), 'nenhum bucket igreja no Storage');

-- B cria itens COMPARTILHADOS (outra família não pode ver nem assim) -------------------------
set local role authenticated;
select pg_temp.as_user(current_setting('t.bru')::uuid);
insert into public.igreja_words (household_id, kind, body, shared) values (current_setting('t.hb')::uuid, 'promessa', 'B', true);
insert into public.igreja_prayers (household_id, title, shared) values (current_setting('t.hb')::uuid, 'B', true);
insert into public.igreja_purposes (household_id, title, shared) values (current_setting('t.hb')::uuid, 'B', true);
insert into public.igreja_carisma_lessons (household_id, title, shared) values (current_setting('t.hb')::uuid, 'B', true);
select set_config('t.les_b', (select id::text from public.igreja_carisma_lessons), true);
insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (current_setting('t.hb')::uuid, current_setting('t.les_b')::uuid, current_setting('t.acc_b')::uuid, 'fileB', 'application/pdf', 10, 'b.pdf');
insert into public.google_drive_folders (household_id, google_account_id, key, folder_id)
  values (current_setting('t.hb')::uuid, current_setting('t.acc_b')::uuid, 'root', 'folderB');

-- 1) Anotações e Promessas -------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.ana')::uuid);
select lives_ok(format($$ insert into public.igreja_words (household_id, kind, title, body, reference) values (%L, 'promessa', 'Casa', 'Deus dará', 'Sl 37:4') $$,
  current_setting('t.ha')), 'dono cria promessa (privada)');
select set_config('t.w_priv', (select id::text from public.igreja_words where title = 'Casa'), true);
select lives_ok(format($$ insert into public.igreja_words (household_id, kind, body, shared) values (%L, 'anotacao', 'Culto de domingo', true) $$,
  current_setting('t.ha')), 'dono cria anotação compartilhada');
select set_config('t.w_sh', (select id::text from public.igreja_words where shared and kind = 'anotacao'), true);
select is((select owner_id::text from public.igreja_words where id = current_setting('t.w_priv')::uuid), current_setting('t.ana'), 'owner_id padrão = auth.uid()');
select is((select received_on from public.igreja_words where id = current_setting('t.w_priv')::uuid), current_date, 'received_on padrão = hoje');
select is((select shared from public.igreja_words where id = current_setting('t.w_priv')::uuid), false, 'shared padrão = false');
select is((select count(*)::int from public.igreja_words), 2, 'dono lê os próprios itens (não vê os de B)');
select lives_ok(format($$ update public.igreja_words set fulfilled_on = current_date where id = %L $$, current_setting('t.w_priv')), 'dono marca promessa cumprida');
select throws_ok(format($$ update public.igreja_words set fulfilled_on = current_date where id = %L $$, current_setting('t.w_sh')), '23514', null, 'fulfilled_on só em promessa');
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body) values (%L, 'sonho', 'x') $$, current_setting('t.ha')), '23514', null, 'kind fora da lista');
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body) values (%L, 'anotacao', '') $$, current_setting('t.ha')), '23514', null, 'body vazio');
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body) values (%L, 'anotacao', repeat('a', 5001)) $$, current_setting('t.ha')), '23514', null, 'body > 5000');
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body, title) values (%L, 'anotacao', 'x', repeat('a', 121)) $$, current_setting('t.ha')), '23514', null, 'title > 120');
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body, reference) values (%L, 'anotacao', 'x', repeat('a', 121)) $$, current_setting('t.ha')), '23514', null, 'reference > 120');
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body, owner_id) values (%L, 'anotacao', 'x', %L) $$, current_setting('t.ha'), current_setting('t.cai')), '42501', null, 'owner_id forjado (cônjuge) no insert falha');
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body) values (%L, 'anotacao', 'x') $$, current_setting('t.hb')), '42501', null, 'não insere em outra família');
select throws_ok(format($$ update public.igreja_words set owner_id = %L where id = %L $$, current_setting('t.cai'), current_setting('t.w_priv')), '42501', null, 'dono não transfere owner_id para outro');
-- cônjuge
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select array_agg(id::text) from public.igreja_words), array[current_setting('t.w_sh')], 'cônjuge só vê o compartilhado');
update public.igreja_words set body = 'hack', shared = false where id = current_setting('t.w_sh')::uuid;
update public.igreja_words set body = 'hack' where id = current_setting('t.w_priv')::uuid;
delete from public.igreja_words;
select throws_ok(format($$ insert into public.igreja_words (household_id, kind, body, owner_id) values (%L, 'anotacao', 'x', %L) $$, current_setting('t.ha'), current_setting('t.ana')), '42501', null, 'cônjuge não cria item em nome do dono');
select pg_temp.as_user(current_setting('t.ana')::uuid);
select is((select count(*)::int from public.igreja_words where body = 'hack'), 0, 'cônjuge não edita (nem compartilhado nem privado)');
select is((select shared from public.igreja_words where id = current_setting('t.w_sh')::uuid), true, 'cônjuge não muda shared');
select is((select count(*)::int from public.igreja_words), 2, 'cônjuge não apaga');
-- outra família
select pg_temp.as_user(current_setting('t.bru')::uuid);
select is((select count(*)::int from public.igreja_words where household_id = current_setting('t.ha')::uuid), 0, 'outra família não vê compartilhado de A');
update public.igreja_words set body = 'hack' where household_id = current_setting('t.ha')::uuid;
delete from public.igreja_words where household_id = current_setting('t.ha')::uuid;
select pg_temp.as_user(current_setting('t.ana')::uuid);
select is((select count(*)::int from public.igreja_words where body <> 'hack'), 2, 'outra família não altera nem apaga');
-- updated_at e delete
reset role;
update public.igreja_words set updated_at = '2000-01-01' where id = current_setting('t.w_sh')::uuid;
set local role authenticated;
update public.igreja_words set title = 'Novo' where id = current_setting('t.w_sh')::uuid;
select ok((select updated_at > '2000-01-02' from public.igreja_words where id = current_setting('t.w_sh')::uuid), 'updated_at atualizado por trigger');
select lives_ok(format($$ update public.igreja_words set shared = false where id = %L $$, current_setting('t.w_sh')), 'dono desfaz compartilhamento');
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select count(*)::int from public.igreja_words), 0, 'cônjuge deixa de ver ao descompartilhar');
select pg_temp.as_user(current_setting('t.ana')::uuid);
select lives_ok(format($$ delete from public.igreja_words where id = %L $$, current_setting('t.w_priv')), 'dono apaga');
select is((select count(*)::int from public.igreja_words), 1, 'item apagado');

-- 2) Orações ---------------------------------------------------------------------------------
select lives_ok(format($$ insert into public.igreja_prayers (household_id, title, person, details) values (%L, 'Saúde', 'Mãe', 'cirurgia') $$, current_setting('t.ha')), 'dono cria oração privada');
select set_config('t.p_priv', (select id::text from public.igreja_prayers where title = 'Saúde'), true);
select lives_ok(format($$ insert into public.igreja_prayers (household_id, title, shared) values (%L, 'Emprego', true) $$, current_setting('t.ha')), 'dono cria oração compartilhada');
select set_config('t.p_sh', (select id::text from public.igreja_prayers where title = 'Emprego'), true);
select is((select status from public.igreja_prayers where id = current_setting('t.p_priv')::uuid), 'orando', 'status padrão = orando');
select throws_ok(format($$ update public.igreja_prayers set answered_on = current_date where id = %L $$, current_setting('t.p_priv')), '23514', null, 'answered_on só em respondida');
select throws_ok(format($$ update public.igreja_prayers set answer_notes = 'x' where id = %L $$, current_setting('t.p_priv')), '23514', null, 'answer_notes só em respondida');
select lives_ok(format($$ update public.igreja_prayers set status = 'respondida', answered_on = current_date, answer_notes = 'Glória' where id = %L $$, current_setting('t.p_priv')), 'dono marca respondida');
select throws_ok(format($$ update public.igreja_prayers set status = 'orando' where id = %L $$, current_setting('t.p_priv')), '23514', null, 'voltar a orando exige limpar resposta');
select throws_ok(format($$ update public.igreja_prayers set status = 'x' where id = %L $$, current_setting('t.p_sh')), '23514', null, 'status fora da lista');
select throws_ok(format($$ insert into public.igreja_prayers (household_id, title) values (%L, '') $$, current_setting('t.ha')), '23514', null, 'title vazio');
select throws_ok(format($$ insert into public.igreja_prayers (household_id, title, person) values (%L, 'x', repeat('a', 121)) $$, current_setting('t.ha')), '23514', null, 'person > 120');
select throws_ok(format($$ insert into public.igreja_prayers (household_id, title, details) values (%L, 'x', repeat('a', 2001)) $$, current_setting('t.ha')), '23514', null, 'details > 2000');
select throws_ok(format($$ insert into public.igreja_prayers (household_id, title, owner_id) values (%L, 'x', %L) $$, current_setting('t.ha'), current_setting('t.cai')), '42501', null, 'owner_id forjado falha (orações)');
select throws_ok(format($$ update public.igreja_prayers set owner_id = %L where id = %L $$, current_setting('t.cai'), current_setting('t.p_sh')), '42501', null, 'não troca owner_id (orações)');
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select array_agg(id::text) from public.igreja_prayers), array[current_setting('t.p_sh')], 'cônjuge só vê oração compartilhada');
update public.igreja_prayers set title = 'hack', shared = false;
delete from public.igreja_prayers;
select pg_temp.as_user(current_setting('t.bru')::uuid);
select is((select count(*)::int from public.igreja_prayers where household_id = current_setting('t.ha')::uuid), 0, 'outra família não vê orações de A');
update public.igreja_prayers set title = 'hack' where household_id = current_setting('t.ha')::uuid;
delete from public.igreja_prayers where household_id = current_setting('t.ha')::uuid;
select pg_temp.as_user(current_setting('t.ana')::uuid);
select is((select count(*)::int from public.igreja_prayers where title <> 'hack' and (id <> current_setting('t.p_sh')::uuid or shared)), 2, 'cônjuge/outra família não editam, não descompartilham, não apagam orações');
select lives_ok(format($$ delete from public.igreja_prayers where id = %L $$, current_setting('t.p_priv')), 'dono apaga oração');

-- 3) Propósitos ------------------------------------------------------------------------------
select lives_ok(format($$ insert into public.igreja_purposes (household_id, title, starts_on, ends_on) values (%L, 'Jejum', '2026-11-01', '2026-11-21') $$, current_setting('t.ha')), 'dono cria propósito privado');
select set_config('t.u_priv', (select id::text from public.igreja_purposes where title = 'Jejum'), true);
select lives_ok(format($$ insert into public.igreja_purposes (household_id, title, shared) values (%L, 'Leitura', true) $$, current_setting('t.ha')), 'dono cria propósito compartilhado');
select set_config('t.u_sh', (select id::text from public.igreja_purposes where title = 'Leitura'), true);
select is((select status from public.igreja_purposes where id = current_setting('t.u_priv')::uuid), 'planejado', 'status padrão = planejado');
select lives_ok(format($$ update public.igreja_purposes set status = 'em_andamento' where id = %L $$, current_setting('t.u_priv')), 'em_andamento aceito');
select lives_ok(format($$ update public.igreja_purposes set status = 'concluido' where id = %L $$, current_setting('t.u_priv')), 'concluido aceito');
select throws_ok(format($$ update public.igreja_purposes set status = 'pausado' where id = %L $$, current_setting('t.u_priv')), '23514', null, 'status de propósito fora da lista');
select throws_ok(format($$ update public.igreja_purposes set ends_on = '2026-10-01' where id = %L $$, current_setting('t.u_priv')), '23514', null, 'ends_on antes de starts_on');
select throws_ok(format($$ insert into public.igreja_purposes (household_id, title, description) values (%L, 'x', repeat('a', 2001)) $$, current_setting('t.ha')), '23514', null, 'description > 2000');
select throws_ok(format($$ insert into public.igreja_purposes (household_id, title, notes) values (%L, 'x', repeat('a', 2001)) $$, current_setting('t.ha')), '23514', null, 'notes > 2000');
select throws_ok(format($$ insert into public.igreja_purposes (household_id, title) values (%L, repeat('a', 121)) $$, current_setting('t.ha')), '23514', null, 'title > 120');
select throws_ok(format($$ insert into public.igreja_purposes (household_id, title, owner_id) values (%L, 'x', %L) $$, current_setting('t.ha'), current_setting('t.cai')), '42501', null, 'owner_id forjado falha (propósitos)');
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select array_agg(id::text) from public.igreja_purposes), array[current_setting('t.u_sh')], 'cônjuge só vê propósito compartilhado');
update public.igreja_purposes set title = 'hack', shared = false;
delete from public.igreja_purposes;
select pg_temp.as_user(current_setting('t.bru')::uuid);
select is((select count(*)::int from public.igreja_purposes where household_id = current_setting('t.ha')::uuid), 0, 'outra família não vê propósitos de A');
select pg_temp.as_user(current_setting('t.ana')::uuid);
select is((select count(*)::int from public.igreja_purposes where title <> 'hack'), 2, 'cônjuge não edita nem apaga propósitos');
select is((select shared from public.igreja_purposes where id = current_setting('t.u_sh')::uuid), true, 'cônjuge não muda shared do propósito');
select lives_ok(format($$ delete from public.igreja_purposes where id = %L $$, current_setting('t.u_priv')), 'dono apaga propósito');

-- 4) Aulas do Carisma ------------------------------------------------------------------------
select lives_ok(format($$ insert into public.igreja_carisma_lessons (household_id, title, lesson_date, subject, teacher) values (%L, 'Aula privada', '2026-11-10', 'Teologia', 'Pr. X') $$, current_setting('t.ha')), 'dono cria aula privada');
select set_config('t.l_priv', (select id::text from public.igreja_carisma_lessons where title = 'Aula privada'), true);
select lives_ok(format($$ insert into public.igreja_carisma_lessons (household_id, title, shared, drive_folder_id) values (%L, 'Aula compartilhada', true, 'abc_DEF-123') $$, current_setting('t.ha')), 'dono cria aula compartilhada com pasta do Drive');
select set_config('t.l_sh', (select id::text from public.igreja_carisma_lessons where title = 'Aula compartilhada'), true);
select is((select summary_status from public.igreja_carisma_lessons where id = current_setting('t.l_priv')::uuid), 'nenhum', 'summary_status padrão = nenhum');
select lives_ok(format($$ update public.igreja_carisma_lessons set summary = 'resumo', summary_status = 'pronto', summarized_at = now() where id = %L $$, current_setting('t.l_priv')), 'dono grava resumo');
select throws_ok(format($$ update public.igreja_carisma_lessons set summary_status = 'gerando' where id = %L $$, current_setting('t.l_priv')), '23514', null, 'summary_status fora da lista');
select throws_ok(format($$ update public.igreja_carisma_lessons set drive_folder_id = '../x' where id = %L $$, current_setting('t.l_priv')), '23514', null, 'drive_folder_id com caracteres inválidos');
select throws_ok(format($$ update public.igreja_carisma_lessons set drive_folder_id = '' where id = %L $$, current_setting('t.l_priv')), '23514', null, 'drive_folder_id vazio');
select throws_ok(format($$ insert into public.igreja_carisma_lessons (household_id, title) values (%L, repeat('a', 161)) $$, current_setting('t.ha')), '23514', null, 'title > 160');
select throws_ok(format($$ insert into public.igreja_carisma_lessons (household_id, title, notes) values (%L, 'x', repeat('a', 10001)) $$, current_setting('t.ha')), '23514', null, 'notes > 10000');
select throws_ok(format($$ insert into public.igreja_carisma_lessons (household_id, title, summary) values (%L, 'x', repeat('a', 20001)) $$, current_setting('t.ha')), '23514', null, 'summary > 20000');
select throws_ok(format($$ insert into public.igreja_carisma_lessons (household_id, title, owner_id) values (%L, 'x', %L) $$, current_setting('t.ha'), current_setting('t.cai')), '42501', null, 'owner_id forjado falha (aulas)');
select throws_ok(format($$ update public.igreja_carisma_lessons set owner_id = %L where id = %L $$, current_setting('t.cai'), current_setting('t.l_sh')), '42501', null, 'não troca owner_id (aulas)');
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select array_agg(id::text) from public.igreja_carisma_lessons), array[current_setting('t.l_sh')], 'cônjuge só vê aula compartilhada');
update public.igreja_carisma_lessons set title = 'hack', shared = false;
delete from public.igreja_carisma_lessons;
select pg_temp.as_user(current_setting('t.bru')::uuid);
select is((select count(*)::int from public.igreja_carisma_lessons where household_id = current_setting('t.ha')::uuid), 0, 'outra família não vê aulas de A');
select pg_temp.as_user(current_setting('t.ana')::uuid);
select is((select count(*)::int from public.igreja_carisma_lessons where title <> 'hack'), 2, 'cônjuge não edita nem apaga aulas');
select is((select shared from public.igreja_carisma_lessons where id = current_setting('t.l_sh')::uuid), true, 'cônjuge não muda shared da aula');

-- 5) Arquivos das aulas (Google Drive) -------------------------------------------------------
select lives_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, web_view_link, file_mime, file_size, display_name)
  values (%L, %L, %L, 'f_priv', 'https://drive.google.com/file/d/f_priv/view', 'application/pdf', 1000, 'apostila.pdf') $$,
  current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), 'dono anexa arquivo à aula privada');
select lives_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, web_view_link, file_mime, file_size, display_name)
  values (%L, %L, %L, 'f_sh', 'https://docs.google.com/document/d/f_sh', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 20971520, 'resumo.docx') $$,
  current_setting('t.ha'), current_setting('t.l_sh'), current_setting('t.acc_a')), 'dono anexa docx (20 MB) à aula compartilhada');
select set_config('t.f_priv', (select id::text from public.igreja_carisma_files where drive_file_id = 'f_priv'), true);
select set_config('t.f_sh', (select id::text from public.igreja_carisma_files where drive_file_id = 'f_sh'), true);
select is((select status from public.igreja_carisma_files where id = current_setting('t.f_priv')::uuid), 'pendente', 'status padrão = pendente');
select is((select owner_id::text from public.igreja_carisma_files where id = current_setting('t.f_priv')::uuid), current_setting('t.ana'), 'owner_id padrão do arquivo = auth.uid()');
select lives_ok(format($$ update public.igreja_carisma_files set status = 'pronto' where id = %L $$, current_setting('t.f_priv')), 'dono confirma envio');
select throws_ok(format($$ update public.igreja_carisma_files set status = 'enviando' where id = %L $$, current_setting('t.f_priv')), '23514', null, 'status de arquivo fora da lista');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'f_priv', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23505', null, 'drive_file_id único por conta');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'a/../b', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'drive_file_id com caracteres inválidos');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, repeat('a', 201), 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'drive_file_id > 200');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, web_view_link, file_mime, file_size, display_name)
  values (%L, %L, %L, 'l1', 'https://evil.com/drive.google.com/', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'web_view_link fora do Google');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, web_view_link, file_mime, file_size, display_name)
  values (%L, %L, %L, 'l2', 'javascript:alert(1)//https://drive.google.com/', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'web_view_link javascript: recusado');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, web_view_link, file_mime, file_size, display_name)
  values (%L, %L, %L, 'l3', 'https://drive.google.com.evil.com/x', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'web_view_link com domínio parecido recusado');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, web_view_link, file_mime, file_size, display_name)
  values (%L, %L, %L, 'l4', 'https://drive.google.com/' || repeat('a', 500), 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'web_view_link > 500');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'm1', 'image/gif', 1, 'x.gif') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'file_mime fora da lista');
select lives_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'm2', 'image/jpeg', 1, 'x.jpg') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), 'image/jpeg aceito');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 's1', 'image/png', 20971521, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'file_size > 20 MB');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 's2', 'image/png', 0, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'file_size 0');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'd1', 'image/png', 1, '') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'display_name vazio');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'd2', 'image/png', 1, repeat('a', 121)) $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_a')), '23514', null, 'display_name > 120');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'c1', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_c')), '42501', null, 'conta Google de outro usuário (cônjuge) recusada');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'c2', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_b')), '42501', null, 'conta Google de outra família recusada (RLS)');
select throws_ok(format($$ update public.igreja_carisma_files set google_account_id = %L where id = %L $$, current_setting('t.acc_c'), current_setting('t.f_priv')), '42501', null, 'update não troca para conta Google alheia');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'k1', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.les_b'), current_setting('t.acc_a')), '42501', null, 'aula de outra família recusada (RLS)');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, owner_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, %L, 'o1', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.cai'), current_setting('t.l_priv'), current_setting('t.acc_a')), '42501', null, 'owner_id forjado falha (arquivos)');
select throws_ok(format($$ update public.igreja_carisma_files set owner_id = %L where id = %L $$, current_setting('t.cai'), current_setting('t.f_priv')), '42501', null, 'não troca owner_id (arquivos)');
-- cônjuge com conta Google própria
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select array_agg(id::text) from public.igreja_carisma_files), array[current_setting('t.f_sh')], 'cônjuge só lê arquivo de aula compartilhada');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'z1', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_sh'), current_setting('t.acc_c')), '42501', null, 'cônjuge não insere arquivo em aula compartilhada alheia');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'z2', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_priv'), current_setting('t.acc_c')), '42501', null, 'cônjuge não insere arquivo em aula privada alheia');
update public.igreja_carisma_files set display_name = 'hack';
delete from public.igreja_carisma_files;
select pg_temp.as_user(current_setting('t.bru')::uuid);
select is((select count(*)::int from public.igreja_carisma_files where household_id = current_setting('t.ha')::uuid), 0, 'outra família não vê arquivos de A');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, 'z3', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.l_sh'), current_setting('t.acc_b')), '42501', null, 'outra família não insere arquivo em A');
update public.igreja_carisma_files set display_name = 'hack' where household_id = current_setting('t.ha')::uuid;
delete from public.igreja_carisma_files where household_id = current_setting('t.ha')::uuid;
select pg_temp.as_user(current_setting('t.ana')::uuid);
select is((select count(*)::int from public.igreja_carisma_files where display_name <> 'hack'), 3, 'cônjuge/outra família não editam nem apagam arquivos');
-- descompartilhar a aula esconde os arquivos
update public.igreja_carisma_lessons set shared = false where id = current_setting('t.l_sh')::uuid;
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select count(*)::int from public.igreja_carisma_files), 0, 'aula descompartilhada esconde os arquivos do cônjuge');
select pg_temp.as_user(current_setting('t.ana')::uuid);
select lives_ok(format($$ delete from public.igreja_carisma_files where id = %L $$, current_setting('t.f_sh')), 'dono apaga arquivo');
select lives_ok(format($$ delete from public.igreja_carisma_lessons where id = %L $$, current_setting('t.l_priv')), 'dono apaga aula');
select is((select count(*)::int from public.igreja_carisma_files), 0, 'apagar aula apaga os arquivos (cascade)');

-- 6) google_drive_folders --------------------------------------------------------------------
select lives_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, 'root', 'rootA') $$,
  current_setting('t.ha'), current_setting('t.acc_a')), 'dono da conta cria pasta');
select lives_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, 'carisma', 'carA') $$,
  current_setting('t.ha'), current_setting('t.acc_a')), 'dono da conta cria pasta carisma');
select throws_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, 'root', 'outra') $$,
  current_setting('t.ha'), current_setting('t.acc_a')), '23505', null, 'key única por conta');
select throws_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, 'x', 'a b') $$,
  current_setting('t.ha'), current_setting('t.acc_a')), '23514', null, 'folder_id com caracteres inválidos');
select throws_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, '', 'ok') $$,
  current_setting('t.ha'), current_setting('t.acc_a')), '23514', null, 'key vazia');
select throws_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, repeat('k', 121), 'ok') $$,
  current_setting('t.ha'), current_setting('t.acc_a')), '23514', null, 'key > 120');
select throws_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, 'x', 'ok') $$,
  current_setting('t.ha'), current_setting('t.acc_c')), '42501', null, 'não cria pasta com conta Google do cônjuge');
select throws_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, 'x', 'ok') $$,
  current_setting('t.ha'), current_setting('t.acc_b')), '42501', null, 'não cria pasta com conta de outra família');
select throws_ok(format($$ update public.google_drive_folders set google_account_id = %L where key = 'root' $$,
  current_setting('t.acc_c')), '42501', null, 'não move pasta para conta do cônjuge');
select pg_temp.as_user(current_setting('t.cai')::uuid);
select is((select count(*)::int from public.google_drive_folders), 2, 'membro da família lê as pastas');
update public.google_drive_folders set folder_id = 'hack';
delete from public.google_drive_folders;
select pg_temp.as_user(current_setting('t.bru')::uuid);
select is((select count(*)::int from public.google_drive_folders where household_id = current_setting('t.ha')::uuid), 0, 'outra família não vê pastas de A');
update public.google_drive_folders set folder_id = 'hack' where household_id = current_setting('t.ha')::uuid;
delete from public.google_drive_folders where household_id = current_setting('t.ha')::uuid;
select pg_temp.as_user(current_setting('t.ana')::uuid);
select is((select count(*)::int from public.google_drive_folders where folder_id <> 'hack'), 2, 'cônjuge/outra família não alteram nem apagam pastas');
select lives_ok($$ update public.google_drive_folders set folder_id = 'rootA2' where key = 'root' $$, 'dono da conta altera pasta');
select lives_ok($$ delete from public.google_drive_folders where key = 'carisma' $$, 'dono da conta apaga pasta');
reset role;
delete from public.google_accounts where id = current_setting('t.acc_a')::uuid;
select is((select count(*)::int from public.google_drive_folders where google_account_id = current_setting('t.acc_a')::uuid), 0, 'desconectar conta apaga pastas (cascade)');

-- 6b) igreja_summary_log (imutável, contagem por família) -------------------------------------
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'igreja_summary_log'
  and cmd in ('UPDATE','DELETE','ALL')), 0, 'igreja_summary_log sem política de update/delete');
select ok(not has_table_privilege('authenticated', 'public.igreja_summary_log', 'update,delete,truncate,references,trigger'),
  'authenticated sem update/delete/truncate/references/trigger em igreja_summary_log');
set local role authenticated;
select pg_temp.as_user(current_setting('t.ana')::uuid);
select lives_ok(format($$ insert into public.igreja_summary_log (household_id, lesson_id) values (%L, %L) $$,
  current_setting('t.ha'), current_setting('t.l_sh')), 'membro registra resumo');
select is((select created_by::text from public.igreja_summary_log), current_setting('t.ana'), 'created_by padrão = auth.uid()');
select lives_ok(format($$ insert into public.igreja_summary_log (household_id, lesson_id) values (%L, %L) $$,
  current_setting('t.ha'), current_setting('t.l_priv')), 'lesson_id sem FK: aceita aula já apagada');
select throws_ok(format($$ insert into public.igreja_summary_log (household_id, created_by) values (%L, %L) $$,
  current_setting('t.ha'), current_setting('t.cai')), '42501', null, 'created_by forjado falha');
select throws_ok(format($$ insert into public.igreja_summary_log (household_id, created_at) values (%L, now() - interval '2 days') $$,
  current_setting('t.ha')), '42501', null, 'created_at forjado falha');
select throws_ok(format($$ insert into public.igreja_summary_log (household_id) values (%L) $$,
  current_setting('t.hb')), '42501', null, 'não registra em outra família');
select throws_ok($$ update public.igreja_summary_log set created_at = now() - interval '2 days' $$, '42501', null, 'membro não altera o log');
select throws_ok($$ delete from public.igreja_summary_log $$, '42501', null, 'membro não apaga o log');
select pg_temp.as_user(current_setting('t.cai')::uuid);
select lives_ok(format($$ insert into public.igreja_summary_log (household_id) values (%L) $$, current_setting('t.ha')), 'cônjuge registra resumo (lesson_id null)');
select is((select count(*)::int from public.igreja_summary_log where household_id = current_setting('t.ha')::uuid
  and created_at >= date_trunc('day', now())), 3, 'contagem do dia por família inclui os dois cônjuges');
select throws_ok($$ delete from public.igreja_summary_log $$, '42501', null, 'cônjuge não apaga o log');
select pg_temp.as_user(current_setting('t.bru')::uuid);
select is((select count(*)::int from public.igreja_summary_log), 0, 'outra família não vê o log de A');
reset role;
select is((select count(*)::int from public.igreja_summary_log), 3, 'log intacto após tentativas de update/delete');

-- FKs compostas (superusuário ignora RLS: prova a constraint em si) --------------------------
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, owner_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, %L, 'fk1', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.cai'), current_setting('t.les_b'), current_setting('t.acc_c')),
  '23503', null, 'FK composta: arquivo não aponta para aula de outra família');
select throws_ok(format($$ insert into public.igreja_carisma_files (household_id, owner_id, lesson_id, google_account_id, drive_file_id, file_mime, file_size, display_name)
  values (%L, %L, %L, %L, 'fk2', 'image/png', 1, 'x.png') $$, current_setting('t.ha'), current_setting('t.ana'), current_setting('t.l_sh'), current_setting('t.acc_b')),
  '23503', null, 'FK composta: arquivo não aponta para conta Google de outra família');
select throws_ok(format($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (%L, %L, 'fk', 'ok') $$,
  current_setting('t.ha'), current_setting('t.acc_b')), '23503', null, 'FK composta: pasta não aponta para conta de outra família');

-- 7) anon -------------------------------------------------------------------------------------
set local role anon;
select throws_ok(format('select count(*) from public.%I', t), '42501', null, 'anon não lê ' || t)
from unnest(array['igreja_words','igreja_prayers','igreja_purposes','igreja_carisma_lessons',
  'igreja_carisma_files','google_drive_folders']) as t;
select throws_ok($$ insert into public.igreja_words (household_id, owner_id, kind, body) values (gen_random_uuid(), gen_random_uuid(), 'anotacao', 'x') $$, '42501', null, 'anon não insere anotação');
select throws_ok($$ insert into public.google_drive_folders (household_id, google_account_id, key, folder_id) values (gen_random_uuid(), gen_random_uuid(), 'x', 'x') $$, '42501', null, 'anon não insere pasta');
select throws_ok($$ select count(*) from public.igreja_summary_log $$, '42501', null, 'anon não lê igreja_summary_log');
select throws_ok($$ insert into public.igreja_summary_log (household_id) values (gen_random_uuid()) $$, '42501', null, 'anon não registra resumo');
reset role;
select ok(not has_table_privilege('anon', 'public.igreja_summary_log', 'select,insert,update,delete,truncate,references,trigger'), 'anon sem privilégio em igreja_summary_log');
select ok(not has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete,truncate,references,trigger'), 'anon sem privilégio em ' || t)
from unnest(array['igreja_words','igreja_prayers','igreja_purposes','igreja_carisma_lessons',
  'igreja_carisma_files','google_drive_folders']) as t;
select ok(not has_function_privilege('anon', 'public.igreja_touch()', 'execute'), 'anon sem execute em igreja_touch');

select * from finish();
rollback;
