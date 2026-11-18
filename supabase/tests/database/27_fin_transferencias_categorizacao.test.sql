-- Transferências e origem da categorização em fin_transactions: colunas, checks,
-- trigger do par (máx. 2 por transfer_group, mesma família), seed com
-- 'Pagamento Cartão de Crédito' e regras padrão, e isolamento entre famílias.
begin;
select plan(42);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000027a1', 'ta@teste.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000027a2', 'tb@teste.invalid', 'authenticated', 'authenticated');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Estrutura
select has_column('public', 'fin_transactions', 'transfer_group', 'coluna transfer_group existe');
select col_type_is('public', 'fin_transactions', 'transfer_group', 'uuid', 'transfer_group é uuid');
select col_is_null('public', 'fin_transactions', 'transfer_group', 'transfer_group aceita null');
select col_type_is('public', 'fin_transactions', 'transfer_checked', 'boolean', 'transfer_checked é boolean');
select col_not_null('public', 'fin_transactions', 'transfer_checked', 'transfer_checked é not null');
select col_default_is('public', 'fin_transactions', 'transfer_checked', 'false', 'transfer_checked default false');
select col_type_is('public', 'fin_transactions', 'category_source', 'text', 'category_source é text');
select col_is_null('public', 'fin_transactions', 'category_source', 'category_source aceita null');
select col_type_is('public', 'fin_transactions', 'pluggy_category', 'text', 'pluggy_category é text');
select has_index('public', 'fin_transactions', 'fin_transactions_transfer_group_idx', 'índice de transfer_group existe');
select has_trigger('public', 'fin_transactions', 'fin_transactions_transfer_guard', 'trigger do par existe');
select has_column('public', 'fin_rules', 'origem', 'coluna fin_rules.origem existe');
select col_default_is('public', 'fin_rules', 'origem', 'usuario', 'origem default usuario');

-- Duas famílias: A e B
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000027a1');
select set_config('t.ha', public.create_household('Fam A', 'Ana')::text, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000027a2');
select set_config('t.hb', public.create_household('Fam B', 'Bruno')::text, true);

-- Seed de família nova (vista por A)
select pg_temp.as_user('00000000-0000-0000-0000-0000000027a1');
select is((select count(*)::int from public.fin_categories
           where household_id = current_setting('t.ha')::uuid and kind = 'transferencia'
             and name = 'Pagamento Cartão de Crédito'),
  1, 'seed cria Pagamento Cartão de Crédito');
select is((select count(*)::int from public.fin_categories
           where household_id = current_setting('t.ha')::uuid and name = 'Pagamento de fatura'),
  0, 'seed não cria Pagamento de fatura');
select is((select count(*)::int from public.fin_rules where household_id = current_setting('t.ha')::uuid),
  55, 'seed cria 55 regras padrão');
select is((select c.name from public.fin_rules r join public.fin_categories c on c.id = r.category_id
           where r.household_id = current_setting('t.ha')::uuid and r.pattern = 'pagto cartao'),
  'Pagamento Cartão de Crédito', 'regra pagto cartao → Pagamento Cartão de Crédito');
select is((select c.name from public.fin_rules r join public.fin_categories c on c.id = r.category_id
           where r.household_id = current_setting('t.ha')::uuid and r.pattern = 'droga raia'),
  'Saúde', 'regra droga raia → Saúde');
select is((select c.name || '/' || c.kind from public.fin_rules r join public.fin_categories c on c.id = r.category_id
           where r.household_id = current_setting('t.ha')::uuid and r.pattern = 'rendimento'),
  'Rendimentos/receita', 'regra rendimento → Rendimentos (receita)');
select is((select c.name from public.fin_rules r join public.fin_categories c on c.id = r.category_id
           where r.household_id = current_setting('t.ha')::uuid and r.pattern = 'pagamento de fatura'),
  'Pagamento Cartão de Crédito', 'regra antiga pagamento de fatura aponta para o nome novo');

select is((select count(*)::int from public.fin_rules
           where household_id = current_setting('t.ha')::uuid and origem = 'padrao'),
  55, 'regras da seed ficam com origem padrao');

-- Regra do usuário com o mesmo padrão de uma padrão: a seed não a sobrescreve
delete from public.fin_rules where household_id = current_setting('t.ha')::uuid and pattern = 'netflix';
insert into public.fin_rules (household_id, pattern, category_id)
  select current_setting('t.ha')::uuid, 'netflix', c.id from public.fin_categories c
  where c.household_id = current_setting('t.ha')::uuid and c.name = 'Assinaturas' and c.kind = 'despesa';
reset role;
select public.seed_fin_defaults(current_setting('t.ha')::uuid);
select is((select origem from public.fin_rules
           where household_id = current_setting('t.ha')::uuid and pattern = 'netflix'),
  'usuario', 'regra do usuário com mesmo padrão continua usuario após a seed');
select is((select count(*)::int from public.fin_rules
           where household_id = current_setting('t.ha')::uuid and origem = 'padrao'),
  54, 'seed não remarca regra do usuário como padrao');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000027a1');

-- A cria duas contas (corrente e cartão)
select lives_ok(format($$ insert into public.fin_accounts (household_id, name, kind)
  values (%L, 'Corrente A', 'corrente'), (%L, 'Cartão A', 'cartao') $$,
  current_setting('t.ha'), current_setting('t.ha')), 'A cria contas');
select set_config('t.acc1', (select id::text from public.fin_accounts
  where household_id = current_setting('t.ha')::uuid and name = 'Corrente A'), true);
select set_config('t.acc2', (select id::text from public.fin_accounts
  where household_id = current_setting('t.ha')::uuid and name = 'Cartão A'), true);

-- Membro grava o par (transfer_group, category_source, pluggy_category)
select lives_ok(format($$ insert into public.fin_transactions
  (id, household_id, account_id, date, description, amount, transfer_group, category_source, pluggy_category)
  values ('27000000-0000-0000-0000-000000000001', %L, %L, '2026-11-10', 'Pagamento de fatura', -500,
          '27000000-0000-0000-0000-0000000000a1', 'par', 'Credit card payment') $$,
  current_setting('t.ha'), current_setting('t.acc1')), 'A grava 1ª perna');
select lives_ok(format($$ insert into public.fin_transactions
  (id, household_id, account_id, date, description, amount, transfer_group, category_source)
  values ('27000000-0000-0000-0000-000000000002', %L, %L, '2026-11-10', 'Pagamento recebido', 500,
          '27000000-0000-0000-0000-0000000000a1', 'par') $$,
  current_setting('t.ha'), current_setting('t.acc2')), 'A grava 2ª perna');
select is((select count(*)::int from public.fin_transactions
           where transfer_group = '27000000-0000-0000-0000-0000000000a1' and category_source = 'par'),
  2, 'as duas pernas ficam no mesmo grupo');

-- Trigger: 3º lançamento no grupo é recusado (insert e update)
select throws_ok(format($$ insert into public.fin_transactions
  (household_id, account_id, date, description, amount, transfer_group)
  values (%L, %L, '2026-11-10', 'Terceira', -1, '27000000-0000-0000-0000-0000000000a1') $$,
  current_setting('t.ha'), current_setting('t.acc1')),
  '23514', 'transfer_group já tem 2 lançamentos', '3º lançamento no grupo é recusado');
select lives_ok(format($$ insert into public.fin_transactions
  (id, household_id, account_id, date, description, amount)
  values ('27000000-0000-0000-0000-000000000003', %L, %L, '2026-11-11', 'Avulso', -10) $$,
  current_setting('t.ha'), current_setting('t.acc1')), 'A grava lançamento avulso');
select throws_ok($$ update public.fin_transactions set transfer_group = '27000000-0000-0000-0000-0000000000a1'
  where id = '27000000-0000-0000-0000-000000000003' $$,
  '23514', 'transfer_group já tem 2 lançamentos', 'update para grupo cheio é recusado');
select lives_ok($$ update public.fin_transactions set transfer_group = '27000000-0000-0000-0000-0000000000a1'
  where id = '27000000-0000-0000-0000-000000000001' $$, 'regravar o próprio grupo não conta a si mesmo');

-- Membro marca "não é transferência" e a origem da categoria
select lives_ok($$ update public.fin_transactions
  set transfer_checked = true, category_source = 'manual', transfer_group = '27000000-0000-0000-0000-0000000000a2'
  where id = '27000000-0000-0000-0000-000000000003' $$, 'A altera transfer_checked/category_source');
select ok((select transfer_checked from public.fin_transactions where id = '27000000-0000-0000-0000-000000000003'),
  'transfer_checked gravado');

-- Checks
select throws_ok(format($$ insert into public.fin_transactions
  (household_id, account_id, date, description, amount, category_source)
  values (%L, %L, '2026-11-10', 'x', -1, 'xpto') $$, current_setting('t.ha'), current_setting('t.acc1')),
  '23514', null, 'category_source inválido é recusado');
select throws_ok(format($$ insert into public.fin_transactions
  (household_id, account_id, date, description, amount, pluggy_category)
  values (%L, %L, '2026-11-10', 'x', -1, repeat('x', 81)) $$, current_setting('t.ha'), current_setting('t.acc1')),
  '23514', null, 'pluggy_category com mais de 80 caracteres é recusado');

-- B cria a própria conta
select pg_temp.as_user('00000000-0000-0000-0000-0000000027a2');
select lives_ok(format($$ insert into public.fin_accounts (household_id, name, kind) values (%L, 'Conta B', 'corrente') $$,
  current_setting('t.hb')), 'B cria conta');
select set_config('t.accb', (select id::text from public.fin_accounts where household_id = current_setting('t.hb')::uuid), true);

-- B não lê, não insere, não altera, não apaga lançamentos de A
select is((select count(*)::int from public.fin_transactions where household_id = current_setting('t.ha')::uuid),
  0, 'B não lê lançamentos de A');
select throws_ok(format($$ insert into public.fin_transactions
  (household_id, account_id, date, description, amount, transfer_group, category_source)
  values (%L, %L, '2026-11-10', 'x', -1, '27000000-0000-0000-0000-0000000000a2', 'par') $$,
  current_setting('t.ha'), current_setting('t.acc1')),
  '42501', null, 'B não insere lançamento em A');
update public.fin_transactions set transfer_group = null, category_source = 'regra', transfer_checked = false
  where household_id = current_setting('t.ha')::uuid;
delete from public.fin_transactions where household_id = current_setting('t.ha')::uuid;
reset role;
select is((select count(*)::int from public.fin_transactions
           where household_id = current_setting('t.ha')::uuid
             and transfer_group = '27000000-0000-0000-0000-0000000000a1' and category_source = 'par'),
  2, 'B não altera nem apaga o par de A');
select is((select transfer_checked from public.fin_transactions where id = '27000000-0000-0000-0000-000000000003'),
  true, 'B não altera transfer_checked de A');

-- Grupo não atravessa famílias (sem RLS, o trigger enxerga a perna de A)
select throws_ok(format($$ insert into public.fin_transactions
  (household_id, account_id, date, description, amount, transfer_group)
  values (%L, %L, '2026-11-10', 'x', 10, '27000000-0000-0000-0000-0000000000a2') $$,
  current_setting('t.hb'), current_setting('t.accb')),
  '23514', 'transfer_group pertence a outra família', 'perna em outra família é recusada');

-- anon não acessa
set local role anon;
select throws_ok($$ select count(*) from public.fin_transactions $$, '42501', null, 'anon não lê fin_transactions');
reset role;

select * from finish();
rollback;
