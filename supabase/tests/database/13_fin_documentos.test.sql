-- Finanças / documentos (boletos e comprovantes): isolamento por família, FKs
-- compostas para fin_bills/fin_transactions, checks, trigger updated_at,
-- source 'documento' em fin_transactions, função de caminho e bucket `financas`.
begin;
select plan(76);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'da@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'db@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Família A (d1) e Família B (d2)
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);
reset role;

-- Dados de apoio (contas, conta a pagar, lançamentos) de cada família
insert into public.fin_accounts (household_id, name, kind) values
  (current_setting('t.ha')::uuid, 'Conta A', 'corrente'),
  (current_setting('t.hb')::uuid, 'Conta B', 'corrente');
select set_config('t.acc_a', (select id::text from public.fin_accounts where household_id = current_setting('t.ha')::uuid and name = 'Conta A'), true);
select set_config('t.acc_b', (select id::text from public.fin_accounts where household_id = current_setting('t.hb')::uuid and name = 'Conta B'), true);
insert into public.fin_bills (household_id, name, amount, due_day) values
  (current_setting('t.ha')::uuid, 'Luz A', 200, 10),
  (current_setting('t.hb')::uuid, 'Luz B', 300, 10);
select set_config('t.bill_a', (select id::text from public.fin_bills where name = 'Luz A'), true);
select set_config('t.bill_b', (select id::text from public.fin_bills where name = 'Luz B'), true);
insert into public.fin_transactions (household_id, account_id, date, description, amount) values
  (current_setting('t.ha')::uuid, current_setting('t.acc_a')::uuid, '2026-11-10', 'Tx A', -200),
  (current_setting('t.hb')::uuid, current_setting('t.acc_b')::uuid, '2026-11-10', 'Tx B', -300);
select set_config('t.tx_a', (select id::text from public.fin_transactions where description = 'Tx A'), true);
select set_config('t.tx_b', (select id::text from public.fin_transactions where description = 'Tx B'), true);

select set_config('t.pa', current_setting('t.ha') || '/docs/11111111-1111-1111-1111-111111111111.pdf', true);
select set_config('t.pa2', current_setting('t.ha') || '/docs/22222222-2222-2222-2222-222222222222.jpg', true);
select set_config('t.pb', current_setting('t.hb') || '/docs/33333333-3333-3333-3333-333333333333.pdf', true);

-- 00_helpers ------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.fin_documents'::regclass), 'fin_documents tem RLS ligado');

-- Membro de A: cria, lê, altera ------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size)
  values (%L, %L, 'application/pdf', 1000) $$, current_setting('t.ha'), current_setting('t.pa')), 'A cria documento');
select set_config('t.doc_a', (select id::text from public.fin_documents limit 1), true);
select is((select kind || '/' || status || '/' || extracted::text from public.fin_documents), 'outro/pendente/{}', 'defaults kind/status/extracted');
select is((select created_by from public.fin_documents), '00000000-0000-0000-0000-0000000000d1'::uuid, 'created_by = auth.uid()');
select is((select count(*)::int from public.fin_documents), 1, 'A lê o próprio documento');
select lives_ok(format($$ update public.fin_documents set kind = 'boleto', status = 'confirmado', payee = 'Enel',
  amount = 200, due_date = '2026-11-15', barcode = %L, bill_id = %L, bill_month = '2026-11',
  extracted = '{"payee":"Enel","amount":200}' where id = %L $$,
  repeat('1', 47), current_setting('t.bill_a'), current_setting('t.doc_a')), 'A altera documento (boleto ligado à conta)');
select lives_ok(format($$ update public.fin_documents set transaction_id = %L, paid_on = '2026-11-10' where id = %L $$,
  current_setting('t.tx_a'), current_setting('t.doc_a')), 'A liga documento a lançamento da família');
select is((select bill_id::text || '|' || transaction_id::text from public.fin_documents),
  current_setting('t.bill_a') || '|' || current_setting('t.tx_a'), 'vínculos persistiram');
select is((select count(*)::int from public.fin_documents
  where household_id = current_setting('t.ha')::uuid
    and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
  1, 'contagem diária (fuso São Paulo) via RLS funciona');

-- source 'documento' em fin_transactions
select lives_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount, source)
  values (%L, %L, '2026-11-10', 'Boleto Enel', -200, 'documento') $$, current_setting('t.ha'), current_setting('t.acc_a')),
  'fin_transactions aceita source = documento');
select throws_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount, source)
  values (%L, %L, '2026-11-10', 'X', -1, 'pdf') $$, current_setting('t.ha'), current_setting('t.acc_a')),
  '23514', null, 'fin_transactions continua rejeitando source fora da lista');
select lives_ok(format($$ insert into public.fin_transactions (household_id, account_id, date, description, amount, source)
  values (%L, %L, '2026-11-10', 'Y', -1, 'openfinance') $$, current_setting('t.ha'), current_setting('t.acc_a')),
  'fin_transactions continua aceitando source original (openfinance)');

-- FKs compostas: bill/transaction de outra família --------------------------------
select throws_ok(format($$ update public.fin_documents set bill_id = %L where id = %L $$,
  current_setting('t.bill_b'), current_setting('t.doc_a')), '23503', null, 'FK composta: bill_id de B é rejeitado');
select throws_ok(format($$ update public.fin_documents set transaction_id = %L where id = %L $$,
  current_setting('t.tx_b'), current_setting('t.doc_a')), '23503', null, 'FK composta: transaction_id de B é rejeitado');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, bill_id, bill_month)
  values (%L, 'p', 'application/pdf', 1, %L, '2026-11') $$, current_setting('t.ha'), current_setting('t.bill_b')),
  '23503', null, 'FK composta: insert com bill_id de B é rejeitado');

-- checks ----------------------------------------------------------------------
select throws_ok(format($$ update public.fin_documents set kind = 'nota' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'kind fora da lista');
select throws_ok(format($$ update public.fin_documents set status = 'apagado' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'status fora da lista');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size)
  values (%L, 'p', 'image/png', 1) $$, current_setting('t.ha')), '23514', null, 'mime fora da lista');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size)
  values (%L, 'p', 'application/pdf', 5242881) $$, current_setting('t.ha')), '23514', null, 'arquivo acima de 5 MB');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size)
  values (%L, 'p', 'application/pdf', 0) $$, current_setting('t.ha')), '23514', null, 'arquivo vazio');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size)
  values (%L, %L, 'application/pdf', 1) $$, current_setting('t.ha'), repeat('x', 301)), '23514', null, 'file_path acima de 300');
select throws_ok(format($$ update public.fin_documents set barcode = %L where id = %L $$, repeat('1', 43), current_setting('t.doc_a')), '23514', null, 'barcode com 43 dígitos');
select throws_ok(format($$ update public.fin_documents set barcode = %L where id = %L $$, repeat('1', 49), current_setting('t.doc_a')), '23514', null, 'barcode com 49 dígitos');
select throws_ok(format($$ update public.fin_documents set barcode = %L where id = %L $$, repeat('1', 46) || 'a', current_setting('t.doc_a')), '23514', null, 'barcode com letra');
select lives_ok(format($$ update public.fin_documents set barcode = %L where id = %L $$, repeat('2', 44), current_setting('t.doc_a')), 'barcode com 44 dígitos é aceito');
select throws_ok(format($$ update public.fin_documents set bill_month = '2026-13' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'bill_month mês 13');
select throws_ok(format($$ update public.fin_documents set bill_month = '2026-1' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'bill_month fora do formato');
select throws_ok(format($$ update public.fin_documents set extracted = '[1,2]' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'extracted array é rejeitado');
select throws_ok(format($$ update public.fin_documents set extracted = '"texto"' where id = %L $$, current_setting('t.doc_a')), '23514', null, 'extracted string é rejeitado');
select throws_ok(format($$ update public.fin_documents set extracted = jsonb_build_object('t', (select string_agg(md5(i::text), '') from generate_series(1, 1000) i)) where id = %L $$,
  current_setting('t.doc_a')), '23514', null, 'extracted acima de 16 KB é rejeitado');
select throws_ok(format($$ update public.fin_documents set amount = 0 where id = %L $$, current_setting('t.doc_a')), '23514', null, 'amount zero');
select throws_ok(format($$ update public.fin_documents set amount = 10000000.01 where id = %L $$, current_setting('t.doc_a')), '23514', null, 'amount acima do limite');
select throws_ok(format($$ update public.fin_documents set payee = %L where id = %L $$, repeat('x', 121), current_setting('t.doc_a')), '23514', null, 'payee acima de 120');

-- anti-duplicidade (índices únicos parciais) e bill_month obrigatório ----------------
select throws_ok(format($$ update public.fin_documents set bill_month = null where id = %L $$, current_setting('t.doc_a')),
  '23514', null, 'bill_month obrigatório quando há bill_id');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, bill_id)
  values (%L, 'p', 'application/pdf', 1, %L) $$, current_setting('t.ha'), current_setting('t.bill_a')),
  '23514', null, 'insert com bill_id sem bill_month é rejeitado');
-- doc_a: boleto confirmado, conta Luz A, 2026-11, barcode 2x44
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, status, bill_id, bill_month)
  values (%L, 'p', 'application/pdf', 1, 'confirmado', %L, '2026-11') $$, current_setting('t.ha'), current_setting('t.bill_a')),
  '23505', null, 'dois confirmados na mesma conta+mês falham');
select lives_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, status, bill_id, bill_month)
  values (%L, 'p', 'application/pdf', 1, 'pendente', %L, '2026-11') $$, current_setting('t.ha'), current_setting('t.bill_a')),
  'pendente na mesma conta+mês é aceito');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, kind, barcode)
  values (%L, 'p', 'application/pdf', 1, 'boleto', %L) $$, current_setting('t.ha'), repeat('2', 44)),
  '23505', null, 'barcode repetido em boletos não descartados falha');
select lives_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, kind, barcode)
  values (%L, 'p', 'application/pdf', 1, 'comprovante', %L) $$, current_setting('t.ha'), repeat('2', 44)),
  'barcode igual em comprovante não é barrado');
select lives_ok(format($$ update public.fin_documents set status = 'descartado' where id = %L $$, current_setting('t.doc_a')), 'A descarta o documento antigo');
select lives_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, kind, status, barcode, bill_id, bill_month)
  values (%L, 'p', 'application/pdf', 1, 'boleto', 'confirmado', %L, %L, '2026-11') $$, current_setting('t.ha'), repeat('2', 44), current_setting('t.bill_a')),
  'um descartado + um confirmado (mesma conta+mês e mesmo barcode) passa');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select lives_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, kind, barcode)
  values (%L, 'p', 'application/pdf', 1, 'boleto', %L) $$, current_setting('t.hb'), repeat('2', 44)),
  'mesmo barcode em outra família não é barrado');
reset role;
delete from public.fin_documents where id <> current_setting('t.doc_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');

-- trigger updated_at ------------------------------------------------------------
reset role;
update public.fin_documents set updated_at = '2000-01-01' where id = current_setting('t.doc_a')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
update public.fin_documents set payee = 'Enel SP' where id = current_setting('t.doc_a')::uuid;
select ok((select updated_at > '2000-01-01' from public.fin_documents), 'trigger atualiza updated_at');

-- Outra família: não lê, não insere, não altera, não apaga --------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.fin_documents), 0, 'B não lê documentos de A');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size)
  values (%L, 'p', 'application/pdf', 1) $$, current_setting('t.ha')), '42501', null, 'B não insere documento em A');
select is_empty(format($$ update public.fin_documents set payee = 'hack' where id = %L returning 1 $$, current_setting('t.doc_a')), 'B não altera documento de A');
select is_empty(format($$ delete from public.fin_documents where id = %L returning 1 $$, current_setting('t.doc_a')), 'B não apaga documento de A');
select throws_ok(format($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size, transaction_id)
  values (%L, 'p', 'application/pdf', 1, %L) $$, current_setting('t.hb'), current_setting('t.tx_a')),
  '23503', null, 'FK composta: B não liga documento a lançamento de A');

-- on delete set null nos vínculos ----------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok(format($$ update public.fin_documents set bill_id = %L where id = %L $$, current_setting('t.bill_a'), current_setting('t.doc_a')), 'religa conta');
select lives_ok(format($$ delete from public.fin_transactions where id = %L $$, current_setting('t.tx_a')), 'A apaga o lançamento');
select lives_ok(format($$ delete from public.fin_bills where id = %L $$, current_setting('t.bill_a')), 'A apaga a conta a pagar');
select is((select coalesce(bill_id::text, 'null') || '|' || coalesce(transaction_id::text, 'null') || '|' || household_id::text from public.fin_documents),
  'null|null|' || current_setting('t.ha'), 'bill_id/transaction_id viram null e household_id fica');

-- membro apaga ------------------------------------------------------------------------
select lives_ok(format($$ delete from public.fin_documents where id = %L $$, current_setting('t.doc_a')), 'A apaga documento');
select is((select count(*)::int from public.fin_documents), 0, 'documento apagado');

-- função de caminho ----------------------------------------------------------------------
select is(public.fin_doc_path_household(current_setting('t.pa')), current_setting('t.ha')::uuid, 'caminho .pdf válido retorna household');
select is(public.fin_doc_path_household(current_setting('t.pa2')), current_setting('t.ha')::uuid, 'caminho .jpg válido retorna household');
select is(public.fin_doc_path_household(current_setting('t.ha') || '/docs/11111111-1111-1111-1111-111111111111.png'), null, 'extensão png => null');
select is(public.fin_doc_path_household(current_setting('t.ha') || '/cards/11111111-1111-1111-1111-111111111111.pdf'), null, 'pasta errada => null');
select is(public.fin_doc_path_household('nao-e-uuid/docs/11111111-1111-1111-1111-111111111111.pdf'), null, 'household não-uuid => null sem erro de cast');
select is(public.fin_doc_path_household(current_setting('t.ha') || '/docs/../' || current_setting('t.hb') || '/docs/11111111-1111-1111-1111-111111111111.pdf'), null, 'traversal => null');
select is(public.fin_doc_path_household(current_setting('t.ha') || '/docs/x.pdf'), null, 'nome de arquivo não-uuid => null');

reset role;
select ok(not has_function_privilege('anon', 'public.fin_doc_path_household(text)', 'execute'), 'anon sem execute em fin_doc_path_household');
select ok(has_function_privilege('authenticated', 'public.fin_doc_path_household(text)', 'execute'), 'authenticated executa fin_doc_path_household');
select ok(not has_function_privilege('authenticated', 'public.fin_documents_touch()', 'execute'), 'authenticated sem execute em fin_documents_touch');

-- anon --------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from public.fin_documents $$, '42501', null, 'anon não lê fin_documents');
select throws_ok($$ insert into public.fin_documents (household_id, file_path, file_mime, file_size)
  values (gen_random_uuid(), 'p', 'application/pdf', 1) $$, '42501', null, 'anon não insere fin_documents');
select throws_ok($$ select public.fin_doc_path_household('x') $$, '42501', null, 'anon não executa fin_doc_path_household');
reset role;

-- storage (delete direto em storage.objects é bloqueado pelo Supabase; política de delete não é testável em SQL)
select is((select public::text || '|' || file_size_limit::text || '|' || allowed_mime_types::text from storage.buckets where id = 'financas'),
  'false|5242880|{application/pdf,image/jpeg}', 'bucket financas privado, 5 MB, só PDF e JPEG');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('financas', %L, %L) $$,
  current_setting('t.pa'), '00000000-0000-0000-0000-0000000000d1'), 'A envia arquivo para a pasta da própria família');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('financas', %L) $$, current_setting('t.pb')),
  '42501', null, 'A não envia arquivo para a pasta de B');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('financas', %L) $$, current_setting('t.ha') || '/outra/x.pdf'),
  '42501', null, 'caminho fora do padrão é negado');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('outro', %L) $$, current_setting('t.pa2')),
  '42501', null, 'política não vale para outro bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'financas'), 1, 'A lê o próprio arquivo');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from storage.objects where bucket_id = 'financas'), 0, 'B não lê arquivos de A');
select is_empty($$ update storage.objects set name = name where bucket_id = 'financas' returning 1 $$, 'B não altera arquivos de A');
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'financas'), 0, 'anon não lê arquivos do bucket');
reset role;

select * from finish();
rollback;
