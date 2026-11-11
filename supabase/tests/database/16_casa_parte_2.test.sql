-- Casa parte 2: fin_bills.is_home, documentos/garantias, cardápio, prestadores,
-- casa_maintenance.provider_id — isolamento por família, FKs compostas, checks,
-- trigger dos ingredientes, updated_at, anon, função de caminho e bucket `casa`.
begin;
select plan(137);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'ea@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'eb@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3', 'ec@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A: Ana (e1) + cônjuge Caio (e3). Família B: Bruno (e2).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;
select set_config('t.code_a', (select invite_code from public.households where id = current_setting('t.ha')::uuid), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select public.join_household(current_setting('t.code_a'), 'Caio');
reset role;

select set_config('t.pa', current_setting('t.ha') || '/docs/11111111-1111-1111-1111-111111111111.pdf', true);
select set_config('t.pa2', current_setting('t.ha') || '/docs/22222222-2222-2222-2222-222222222222.jpg', true);
select set_config('t.pb', current_setting('t.hb') || '/docs/33333333-3333-3333-3333-333333333333.pdf', true);

-- 00_helpers / estrutura ----------------------------------------------------------
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'todas as tabelas de public (inclusive as novas) têm RLS ligado');

-- Despensa removida de vez ------------------------------------------------------
select hasnt_table('public', 'casa_pantry_items', 'casa_pantry_items removida');
select hasnt_column('public', 'casa_shopping_items', 'pantry_item_id', 'casa_shopping_items.pantry_item_id removida');
select is_empty($$ select 1 from pg_indexes where schemaname = 'public'
  and indexname in ('casa_shopping_pantry_pending_uq', 'casa_shopping_items_pantry_idx') $$, 'índices da despensa removidos');

-- B cria registros próprios (para testar FKs compostas e isolamento) ---------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
insert into public.fin_bills (household_id, name, amount, due_day, is_home) values (current_setting('t.hb')::uuid, 'Luz B', 300, 10, true);
insert into public.casa_providers (household_id, name, service) values (current_setting('t.hb')::uuid, 'Eletricista B', 'eletricista');
insert into public.casa_maintenance (household_id, name, interval_value, interval_unit) values (current_setting('t.hb')::uuid, 'Filtro B', 6, 'meses');
insert into public.casa_meal_plan (household_id, day, meal, title) values (current_setting('t.hb')::uuid, '2026-11-10', 'jantar', 'Sopa B');
insert into public.casa_documents (household_id, title) values (current_setting('t.hb')::uuid, 'Geladeira B');
select set_config('t.bill_b', (select id::text from public.fin_bills), true);
select set_config('t.pr_b', (select id::text from public.casa_providers), true);
select set_config('t.mt_b', (select id::text from public.casa_maintenance), true);

-- 1) fin_bills.is_home ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into public.fin_bills (household_id, name, amount, due_day) values (%L, 'Luz A', 200, 10) $$,
  current_setting('t.ha')), 'A cria conta fixa sem is_home');
select set_config('t.bill_a', (select id::text from public.fin_bills), true);
select is((select is_home from public.fin_bills), false, 'is_home nasce false');
select lives_ok(format($$ update public.fin_bills set is_home = true where id = %L $$, current_setting('t.bill_a')), 'A marca conta como da casa');
select is((select count(*)::int from public.fin_bills where is_home), 1, 'A vê só a própria conta da casa');
select throws_ok(format($$ update public.fin_bills set is_home = null where id = %L $$, current_setting('t.bill_a')), '23502', null, 'is_home não aceita null');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select is((select is_home from public.fin_bills where id = current_setting('t.bill_a')::uuid), true, 'cônjuge lê is_home');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from public.fin_bills where id = current_setting('t.bill_a')::uuid), 0, 'B não lê conta/is_home de A');
select is_empty(format($$ update public.fin_bills set is_home = false where id = %L returning 1 $$, current_setting('t.bill_a')), 'B não altera is_home de A');
select throws_ok(format($$ insert into public.fin_bills (household_id, name, amount, due_day, is_home) values (%L, 'X', 1, 1, true) $$,
  current_setting('t.ha')), '42501', null, 'B não insere conta da casa em A');
reset role;
select is((select is_home from public.fin_bills where id = current_setting('t.bill_a')::uuid), true, 'is_home de A intacto após tentativa de B');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'fin_bills_household_home_idx'
  and indexdef like '%WHERE is_home%'), 'índice parcial fin_bills_household_home_idx existe');
set local role authenticated;

-- 2) Prestadores -------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into public.casa_providers (household_id, name, service, phone, email) values (%L, 'João', 'eletricista', '+55 (11) 99999-0000', 'j@x.invalid') $$,
  current_setting('t.ha')), 'A cria prestador');
select set_config('t.pr_a', (select id::text from public.casa_providers), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select is((select count(*)::int from public.casa_providers), 1, 'cônjuge lê prestador');
select lives_ok(format($$ update public.casa_providers set notes = 'bom' where id = %L $$, current_setting('t.pr_a')), 'cônjuge altera prestador');

select throws_ok(format($$ update public.casa_providers set phone = '11 9999-abc' where id = %L $$, current_setting('t.pr_a')), '23514', null, 'phone com letra');
select throws_ok(format($$ update public.casa_providers set phone = '11#9999' where id = %L $$, current_setting('t.pr_a')), '23514', null, 'phone com #');
select throws_ok(format($$ update public.casa_providers set phone = '' where id = %L $$, current_setting('t.pr_a')), '23514', null, 'phone vazio');
select throws_ok(format($$ update public.casa_providers set phone = repeat('1', 31) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'phone acima de 30');
select lives_ok(format($$ update public.casa_providers set phone = null where id = %L $$, current_setting('t.pr_a')), 'phone nulo aceito');
select throws_ok(format($$ update public.casa_providers set name = '' where id = %L $$, current_setting('t.pr_a')), '23514', null, 'prestador: nome vazio');
select throws_ok(format($$ update public.casa_providers set name = repeat('x', 121) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'prestador: nome acima de 120');
select throws_ok(format($$ update public.casa_providers set service = repeat('x', 81) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'prestador: service acima de 80');
select throws_ok(format($$ update public.casa_providers set email = repeat('x', 121) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'prestador: email acima de 120');
select throws_ok(format($$ update public.casa_providers set notes = repeat('x', 501) where id = %L $$, current_setting('t.pr_a')), '23514', null, 'prestador: notes acima de 500');

-- 3) Manutenção com provider_id (FK composta) ------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into public.casa_maintenance (household_id, name, interval_value, interval_unit, provider, provider_id) values (%L, 'Quadro de luz', 1, 'anos', 'João', %L) $$,
  current_setting('t.ha'), current_setting('t.pr_a')), 'A liga manutenção a prestador da família');
select set_config('t.mt_a', (select id::text from public.casa_maintenance), true);
select is((select provider || '|' || provider_id::text from public.casa_maintenance), 'João|' || current_setting('t.pr_a'), 'provider (texto) e provider_id convivem');
select throws_ok(format($$ update public.casa_maintenance set provider_id = %L where id = %L $$, current_setting('t.pr_b'), current_setting('t.mt_a')),
  '23503', null, 'FK composta: provider_id de B recusado (update)');
select throws_ok(format($$ insert into public.casa_maintenance (household_id, name, interval_value, interval_unit, provider_id) values (%L, 'X', 1, 'dias', %L) $$,
  current_setting('t.ha'), current_setting('t.pr_b')), '23503', null, 'FK composta: provider_id de B recusado (insert)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok(format($$ update public.casa_maintenance set provider_id = %L where id = %L $$, current_setting('t.pr_a'), current_setting('t.mt_b')),
  '23503', null, 'FK composta: B não liga manutenção a prestador de A');

-- 4) Documentos e garantias --------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into public.casa_documents (household_id, title, product, store, purchase_date, warranty_until, amount, file_path, file_mime, file_size)
  values (%L, 'Garantia geladeira', 'Geladeira', 'Loja X', '2026-01-10', '2027-01-10', 3500, %L, 'application/pdf', 1000) $$,
  current_setting('t.ha'), current_setting('t.pa')), 'A cria documento com arquivo');
select set_config('t.doc_a', (select id::text from public.casa_documents), true);
select is((select kind from public.casa_documents), 'garantia', 'kind padrão = garantia');
select is((select created_by from public.casa_documents), '00000000-0000-0000-0000-0000000000e1'::uuid, 'created_by = auth.uid()');
select lives_ok(format($$ insert into public.casa_documents (household_id, kind, title) values (%L, 'manual', 'Manual TV') $$,
  current_setting('t.ha')), 'A cria documento sem arquivo');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select is((select count(*)::int from public.casa_documents), 2, 'cônjuge lê documentos');
select lives_ok(format($$ update public.casa_documents set notes = 'nota' where id = %L $$, current_setting('t.doc_a')), 'cônjuge altera documento');

select throws_ok(format($$ update public.casa_documents set kind = 'boleto' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'documento: kind fora da lista');
select lives_ok(format($$ update public.casa_documents set kind = 'nota_fiscal' where id = %L $$, current_setting('t.doc_a')), 'documento: kind nota_fiscal aceito');
select throws_ok(format($$ update public.casa_documents set warranty_until = '2026-01-09' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'garantia antes da compra');
select lives_ok(format($$ update public.casa_documents set warranty_until = '2026-01-10' where id = %L $$, current_setting('t.doc_a')), 'garantia no dia da compra aceita');
select lives_ok(format($$ update public.casa_documents set purchase_date = null, warranty_until = '2020-01-01' where id = %L $$, current_setting('t.doc_a')), 'garantia sem data de compra aceita');
select throws_ok(format($$ update public.casa_documents set title = '' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'documento: título vazio');
select throws_ok(format($$ update public.casa_documents set title = repeat('x', 121) where id = %L $$, current_setting('t.doc_a')), '23514', null, 'documento: título acima de 120');
select throws_ok(format($$ update public.casa_documents set product = repeat('x', 121) where id = %L $$, current_setting('t.doc_a')), '23514', null, 'documento: product acima de 120');
select throws_ok(format($$ update public.casa_documents set store = repeat('x', 121) where id = %L $$, current_setting('t.doc_a')), '23514', null, 'documento: store acima de 120');
select throws_ok(format($$ update public.casa_documents set notes = repeat('x', 1001) where id = %L $$, current_setting('t.doc_a')), '23514', null, 'documento: notes acima de 1000');
select throws_ok(format($$ update public.casa_documents set amount = -0.01 where id = %L $$, current_setting('t.doc_a')), '23514', null, 'documento: valor negativo');
select lives_ok(format($$ update public.casa_documents set amount = 0 where id = %L $$, current_setting('t.doc_a')), 'documento: valor zero aceito');
select throws_ok(format($$ update public.casa_documents set file_path = null where id = %L $$, current_setting('t.doc_a')), '23514', null, 'arquivo: sem path com mime/size');
select throws_ok(format($$ update public.casa_documents set file_size = null where id = %L $$, current_setting('t.doc_a')), '23514', null, 'arquivo: sem size com path/mime');
select throws_ok(format($$ insert into public.casa_documents (household_id, title, file_path) values (%L, 'X', 'p') $$, current_setting('t.ha')), '23514', null, 'arquivo: só path');
select throws_ok(format($$ insert into public.casa_documents (household_id, title, file_mime, file_size) values (%L, 'X', 'image/jpeg', 1) $$, current_setting('t.ha')), '23514', null, 'arquivo: mime/size sem path');
select lives_ok(format($$ update public.casa_documents set file_path = null, file_mime = null, file_size = null where id = %L $$, current_setting('t.doc_a')), 'arquivo: remover os três juntos aceito');
select throws_ok(format($$ insert into public.casa_documents (household_id, title, file_path, file_mime, file_size) values (%L, 'X', 'p', 'image/png', 1) $$, current_setting('t.ha')), '23514', null, 'arquivo: mime png');
select throws_ok(format($$ insert into public.casa_documents (household_id, title, file_path, file_mime, file_size) values (%L, 'X', 'p', 'application/pdf', 0) $$, current_setting('t.ha')), '23514', null, 'arquivo: vazio');
select throws_ok(format($$ insert into public.casa_documents (household_id, title, file_path, file_mime, file_size) values (%L, 'X', 'p', 'application/pdf', 5242881) $$, current_setting('t.ha')), '23514', null, 'arquivo: acima de 5 MB');
select throws_ok(format($$ insert into public.casa_documents (household_id, title, file_path, file_mime, file_size) values (%L, 'X', %L, 'application/pdf', 1) $$, current_setting('t.ha'), repeat('x', 301)), '23514', null, 'arquivo: path acima de 300');
select lives_ok(format($$ update public.casa_documents set file_path = %L, file_mime = 'image/jpeg', file_size = 5242880 where id = %L $$, current_setting('t.pa2'), current_setting('t.doc_a')), 'arquivo: jpeg de 5 MB aceito');

-- 5) Cardápio -----------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into public.casa_meal_plan (household_id, day, meal, title, ingredients) values (%L, '2026-11-10', 'jantar', 'Macarrão', '{massa,molho}') $$,
  current_setting('t.ha')), 'A cria refeição');
select set_config('t.mp_a', (select id::text from public.casa_meal_plan), true);
select lives_ok(format($$ insert into public.casa_meal_plan (household_id, day, meal, title) values (%L, '2026-11-10', 'almoco', 'Arroz e feijão') $$,
  current_setting('t.ha')), 'A cria outra refeição no mesmo dia');
select is((select ingredients from public.casa_meal_plan where meal = 'almoco'), '{}'::text[], 'ingredients padrão = {}');
select throws_ok(format($$ insert into public.casa_meal_plan (household_id, day, meal, title) values (%L, '2026-11-10', 'jantar', 'Outro') $$,
  current_setting('t.ha')), '23505', null, 'unique: mesma família/dia/refeição recusado');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select is((select count(*)::int from public.casa_meal_plan), 2, 'cônjuge lê cardápio');
select lives_ok(format($$ update public.casa_meal_plan set notes = 'sem pimenta' where id = %L $$, current_setting('t.mp_a')), 'cônjuge altera refeição');

select throws_ok(format($$ update public.casa_meal_plan set meal = 'ceia' where id = %L $$, current_setting('t.mp_a')), '23514', null, 'meal fora da lista');
select throws_ok(format($$ update public.casa_meal_plan set title = '' where id = %L $$, current_setting('t.mp_a')), '23514', null, 'cardápio: título vazio');
select throws_ok(format($$ update public.casa_meal_plan set title = repeat('x', 121) where id = %L $$, current_setting('t.mp_a')), '23514', null, 'cardápio: título acima de 120');
select throws_ok(format($$ update public.casa_meal_plan set notes = repeat('x', 301) where id = %L $$, current_setting('t.mp_a')), '23514', null, 'cardápio: notes acima de 300');
select throws_ok(format($$ update public.casa_meal_plan set ingredients = null where id = %L $$, current_setting('t.mp_a')), '23502', null, 'ingredients não aceita null');
select lives_ok(format($$ update public.casa_meal_plan set ingredients = '{}' where id = %L $$, current_setting('t.mp_a')), 'ingredients vazio aceito');
select throws_ok(format($$ update public.casa_meal_plan set ingredients = '{massa,""}' where id = %L $$, current_setting('t.mp_a')), '23514', null, 'ingrediente vazio recusado');
select throws_ok(format($$ update public.casa_meal_plan set ingredients = array['massa', null] where id = %L $$, current_setting('t.mp_a')), '23514', null, 'ingrediente nulo recusado');
select throws_ok(format($$ update public.casa_meal_plan set ingredients = array[repeat('x', 81)] where id = %L $$, current_setting('t.mp_a')), '23514', null, 'ingrediente acima de 80 recusado');
select lives_ok(format($$ update public.casa_meal_plan set ingredients = array[repeat('x', 80)] where id = %L $$, current_setting('t.mp_a')), 'ingrediente com 80 aceito');
select throws_ok(format($$ update public.casa_meal_plan set ingredients = array_fill('x'::text, array[31]) where id = %L $$, current_setting('t.mp_a')), '23514', null, 'mais de 30 ingredientes recusado');
select lives_ok(format($$ update public.casa_meal_plan set ingredients = array_fill('x'::text, array[30]) where id = %L $$, current_setting('t.mp_a')), '30 ingredientes aceito');
select throws_ok(format($$ update public.casa_meal_plan set ingredients = '{{a,b},{c,d}}' where id = %L $$, current_setting('t.mp_a')), '23514', null, 'ingredients multidimensional recusado');
select throws_ok(format($$ insert into public.casa_meal_plan (household_id, day, meal, title, ingredients) values (%L, '2026-11-11', 'cafe', 'Pão', '{""}') $$,
  current_setting('t.ha')), '23514', null, 'ingrediente vazio recusado também no insert');

-- 6) Outra família: não lê, não insere, não altera, não apaga --------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from public.casa_documents where household_id = current_setting('t.ha')::uuid), 0, 'B não lê documentos de A');
select is((select count(*)::int from public.casa_meal_plan where household_id = current_setting('t.ha')::uuid), 0, 'B não lê cardápio de A');
select is((select count(*)::int from public.casa_providers where household_id = current_setting('t.ha')::uuid), 0, 'B não lê prestadores de A');
select throws_ok(format($$ insert into public.casa_documents (household_id, title) values (%L, 'X') $$, current_setting('t.ha')), '42501', null, 'B não insere documento em A');
select throws_ok(format($$ insert into public.casa_meal_plan (household_id, day, meal, title) values (%L, '2026-12-01', 'cafe', 'X') $$, current_setting('t.ha')), '42501', null, 'B não insere refeição em A');
select throws_ok(format($$ insert into public.casa_providers (household_id, name) values (%L, 'X') $$, current_setting('t.ha')), '42501', null, 'B não insere prestador em A');
select is_empty(format($$ update public.casa_documents set title = 'hack' where id = %L returning 1 $$, current_setting('t.doc_a')), 'B não altera documento de A');
select is_empty(format($$ update public.casa_meal_plan set title = 'hack' where id = %L returning 1 $$, current_setting('t.mp_a')), 'B não altera refeição de A');
select is_empty(format($$ update public.casa_providers set name = 'hack' where id = %L returning 1 $$, current_setting('t.pr_a')), 'B não altera prestador de A');
select is_empty(format($$ update public.casa_providers set household_id = %L where id = %L returning 1 $$, current_setting('t.hb'), current_setting('t.pr_a')), 'B não move prestador de A para B');
select is_empty(format($$ delete from public.casa_documents where id = %L returning 1 $$, current_setting('t.doc_a')), 'B não apaga documento de A');
select is_empty(format($$ delete from public.casa_meal_plan where id = %L returning 1 $$, current_setting('t.mp_a')), 'B não apaga refeição de A');
select is_empty(format($$ delete from public.casa_providers where id = %L returning 1 $$, current_setting('t.pr_a')), 'B não apaga prestador de A');
select lives_ok(format($$ insert into public.casa_meal_plan (household_id, day, meal, title) values (%L, '2026-11-10', 'almoco', 'Arroz B') $$,
  current_setting('t.hb')), 'unique do cardápio é por família (B usa o mesmo dia/refeição de A)');

-- membro A move registro para B: barrado pelo with check ------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok(format($$ update public.casa_documents set household_id = %L where id = %L $$, current_setting('t.hb'), current_setting('t.doc_a')),
  '42501', null, 'A não move documento para B');

-- 7) trigger updated_at ---------------------------------------------------------------------
reset role;
update public.casa_documents set updated_at = '2000-01-01' where id = current_setting('t.doc_a')::uuid;
update public.casa_meal_plan set updated_at = '2000-01-01' where id = current_setting('t.mp_a')::uuid;
update public.casa_providers set updated_at = '2000-01-01' where id = current_setting('t.pr_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
update public.casa_documents set notes = 'Z' where id = current_setting('t.doc_a')::uuid;
update public.casa_meal_plan set notes = 'Z' where id = current_setting('t.mp_a')::uuid;
update public.casa_providers set notes = 'Z' where id = current_setting('t.pr_a')::uuid;
select ok((select updated_at > '2000-01-01' from public.casa_documents where id = current_setting('t.doc_a')::uuid), 'trigger atualiza updated_at (documentos)');
select ok((select updated_at > '2000-01-01' from public.casa_meal_plan where id = current_setting('t.mp_a')::uuid), 'trigger atualiza updated_at (cardápio)');
select ok((select updated_at > '2000-01-01' from public.casa_providers where id = current_setting('t.pr_a')::uuid), 'trigger atualiza updated_at (prestadores)');

-- 8) membro apaga; on delete set null do provider_id -------------------------------------------
select lives_ok(format($$ delete from public.casa_providers where id = %L $$, current_setting('t.pr_a')), 'A apaga prestador');
select is((select coalesce(provider_id::text, 'null') || '|' || provider || '|' || household_id::text from public.casa_maintenance where id = current_setting('t.mt_a')::uuid),
  'null|João|' || current_setting('t.ha'), 'manutenção fica sem provider_id; provider (texto) e household_id ficam');
select lives_ok(format($$ delete from public.casa_documents where id = %L $$, current_setting('t.doc_a')), 'A apaga documento');
select lives_ok(format($$ delete from public.casa_meal_plan where id = %L $$, current_setting('t.mp_a')), 'A apaga refeição');

-- 9) função de caminho --------------------------------------------------------------------------
select is(public.casa_doc_path_household(current_setting('t.pa')), current_setting('t.ha')::uuid, 'caminho .pdf válido retorna household');
select is(public.casa_doc_path_household(current_setting('t.pa2')), current_setting('t.ha')::uuid, 'caminho .jpg válido retorna household');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/docs/11111111-1111-1111-1111-111111111111.png'), null, 'extensão png => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/fotos/11111111-1111-1111-1111-111111111111.pdf'), null, 'pasta errada => null');
select is(public.casa_doc_path_household('nao-e-uuid/docs/11111111-1111-1111-1111-111111111111.pdf'), null, 'household não-uuid => null sem erro de cast');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/docs/../' || current_setting('t.hb') || '/docs/11111111-1111-1111-1111-111111111111.pdf'), null, 'traversal => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/docs/x.pdf'), null, 'nome de arquivo não-uuid => null');
select is(public.casa_doc_path_household(current_setting('t.ha') || '/docs/11111111-1111-1111-1111-111111111111.pdf/extra'), null, 'sufixo extra => null');
reset role;
select ok((select provolatile = 'i' and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.casa_doc_path_household(text)'::regprocedure),
  'casa_doc_path_household é immutable com search_path vazio');
select ok(not has_function_privilege('anon', 'public.casa_doc_path_household(text)', 'execute'), 'anon sem execute em casa_doc_path_household');
select ok(has_function_privilege('authenticated', 'public.casa_doc_path_household(text)', 'execute'), 'authenticated executa casa_doc_path_household');
select ok(not has_function_privilege('authenticated', 'public.casa_meal_plan_check()', 'execute')
  and not has_function_privilege('anon', 'public.casa_meal_plan_check()', 'execute'), 'casa_meal_plan_check sem execute para anon/authenticated');

-- 10) anon -------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from public.casa_documents $$, '42501', null, 'anon não lê documentos');
select throws_ok($$ select count(*) from public.casa_meal_plan $$, '42501', null, 'anon não lê cardápio');
select throws_ok($$ select count(*) from public.casa_providers $$, '42501', null, 'anon não lê prestadores');
select throws_ok($$ insert into public.casa_documents (household_id, title) values (gen_random_uuid(), 'X') $$, '42501', null, 'anon não insere documento');
select throws_ok($$ insert into public.casa_meal_plan (household_id, day, meal, title) values (gen_random_uuid(), '2026-11-10', 'cafe', 'X') $$, '42501', null, 'anon não insere refeição');
select throws_ok($$ insert into public.casa_providers (household_id, name) values (gen_random_uuid(), 'X') $$, '42501', null, 'anon não insere prestador');
select throws_ok($$ select count(*) from public.fin_bills where is_home $$, '42501', null, 'anon não lê fin_bills (is_home)');
select throws_ok($$ select public.casa_doc_path_household('x') $$, '42501', null, 'anon não executa casa_doc_path_household');
reset role;
select ok(not has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.' || t, 'truncate,references,trigger'),
  'grants corretos em ' || t)
from unnest(array['casa_documents','casa_meal_plan','casa_providers']) as t;

-- 11) storage (delete direto em storage.objects é bloqueado pelo Supabase; política de delete não é testável em SQL)
select is((select public::text || '|' || file_size_limit::text || '|' || allowed_mime_types::text from storage.buckets where id = 'casa'),
  'false|5242880|{application/pdf,image/jpeg}', 'bucket casa privado, 5 MB, só PDF e JPEG');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'casa: %'
  and roles = '{authenticated}' and coalesce(qual, with_check) like '%bucket_id = ''casa''%'), 4,
  '4 políticas do bucket casa em storage.objects');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('casa', %L, %L) $$,
  current_setting('t.pa'), '00000000-0000-0000-0000-0000000000e1'), 'A envia arquivo para a pasta da própria família');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('casa', %L) $$, current_setting('t.pb')),
  '42501', null, 'A não envia arquivo para a pasta de B');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('casa', %L) $$, current_setting('t.ha') || '/outra/x.pdf'),
  '42501', null, 'caminho fora do padrão é negado');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('outro', %L) $$, current_setting('t.pa2')),
  '42501', null, 'política não vale para outro bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'casa'), 1, 'A lê o próprio arquivo');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select is((select count(*)::int from storage.objects where bucket_id = 'casa'), 1, 'cônjuge lê arquivo da família');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from storage.objects where bucket_id = 'casa'), 0, 'B não lê arquivos de A');
select is_empty($$ update storage.objects set name = name where bucket_id = 'casa' returning 1 $$, 'B não altera arquivos de A');
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'casa'), 0, 'anon não lê arquivos do bucket');
reset role;

select * from finish();
rollback;
