-- Finanças: transferências entre contas da família e origem da categorização.
-- 1) fin_transactions ganha transfer_group (par de pernas de uma transferência ou
--    pagamento de fatura), transfer_checked ("não é transferência"), category_source
--    (de onde veio a categoria) e pluggy_category (categoria em inglês da Pluggy).
--    Trigger garante no máximo 2 lançamentos por transfer_group, todos da mesma família.
-- 2) Categoria 'Pagamento de fatura' (transferencia) passa a 'Pagamento Cartão de Crédito'.
-- 3) seed_fin_defaults usa o novo nome e semeia mais regras padrão.
-- 4) Famílias existentes recebem as regras padrão novas (sem tocar nas do usuário).
-- 5) Backfill: lançamentos existentes ficam com category_source null (legado).
-- RLS e políticas de fin_transactions não mudam (política "for all" por household_id
-- e grants por tabela cobrem as colunas novas).
-- Rollback: rollbacks/0027_fin_transferencias_categorizacao.rollback.sql

-- 1) Colunas novas ------------------------------------------------------------
alter table public.fin_transactions
  add column transfer_group uuid,
  add column transfer_checked boolean not null default false,
  add column category_source text
    constraint fin_transactions_category_source_check
    check (category_source in ('manual', 'regra', 'historico', 'pluggy', 'par')),
  add column pluggy_category text
    constraint fin_transactions_pluggy_category_check
    check (char_length(pluggy_category) <= 80);

create index fin_transactions_transfer_group_idx
  on public.fin_transactions (household_id, transfer_group)
  where transfer_group is not null;

-- Integridade do par: no máximo 2 linhas por transfer_group, todas da mesma família.
-- Security invoker: a consulta roda com o RLS de quem grava. Basta, porque as duas
-- pernas são da mesma família (uma perna de outra família é invisível e, por isso,
-- também não pode ser ligada: o lançamento dela não é acessível ao chamador).
-- O advisory lock por grupo serializa gravações concorrentes no mesmo transfer_group.
create or replace function public.fin_transactions_transfer_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.transfer_group::text, 27));

  if exists (select 1 from public.fin_transactions t
             where t.transfer_group = new.transfer_group
               and t.id <> new.id
               and t.household_id <> new.household_id) then
    raise exception 'transfer_group pertence a outra família'
      using errcode = '23514';
  end if;

  if (select count(*) from public.fin_transactions t
      where t.transfer_group = new.transfer_group
        and t.id <> new.id) >= 2 then
    raise exception 'transfer_group já tem 2 lançamentos'
      using errcode = '23514';
  end if;

  return new;
end; $$;

create trigger fin_transactions_transfer_guard
  before insert or update of transfer_group, household_id on public.fin_transactions
  for each row when (new.transfer_group is not null)
  execute function public.fin_transactions_transfer_guard();
revoke execute on function public.fin_transactions_transfer_guard() from public, anon, authenticated;

-- 2) Renomeia a categoria de fatura -------------------------------------------
-- Só onde a família ainda não tem 'Pagamento Cartão de Crédito' no mesmo kind
-- (unique (household_id, kind, name)).
update public.fin_categories c
   set name = 'Pagamento Cartão de Crédito'
 where c.kind = 'transferencia'
   and c.name = 'Pagamento de fatura'
   and not exists (select 1 from public.fin_categories o
                   where o.household_id = c.household_id
                     and o.kind = 'transferencia'
                     and o.name = 'Pagamento Cartão de Crédito');

-- 3) seed_fin_defaults: novo nome e regras padrão -----------------------------
-- Padrões são comparados pelo app por palavras inteiras, sem acento e minúsculos.
create or replace function public.seed_fin_defaults(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fin_categories (household_id, name, kind, color)
  select p_household, c.name, c.kind, c.color
  from (values
    ('Moradia','despesa','#7a6a55'), ('Mercado','despesa','#5b7a3a'), ('Alimentação fora','despesa','#c0703e'),
    ('Transporte','despesa','#4f6d8a'), ('Saúde','despesa','#b4432f'), ('Educação','despesa','#6a5a9a'),
    ('Filho','despesa','#c08a3e'), ('Lazer','despesa','#3e8a8a'), ('Vestuário','despesa','#9a5a7a'),
    ('Assinaturas','despesa','#5a6a7a'), ('Contas da casa','despesa','#8a7a3e'), ('Igreja e doações','despesa','#556b2f'),
    ('Presentes','despesa','#a0605a'), ('Cuidados pessoais','despesa','#8a6a9a'), ('Impostos e taxas','despesa','#6e7066'),
    ('Outros gastos','despesa','#8a8d80'),
    ('Salário','receita','#3f7a4a'), ('Renda extra','receita','#4a8a5a'), ('Reembolso','receita','#5a8a7a'),
    ('Rendimentos','receita','#2f6b55'), ('Outras receitas','receita','#6a8a6a'),
    ('Pagamento Cartão de Crédito','transferencia','#8a8d80'), ('Transferência entre contas','transferencia','#8a8d80'),
    ('Aplicação e resgate','transferencia','#8a8d80')
  ) as c(name, kind, color)
  on conflict (household_id, kind, name) do nothing;

  insert into public.fin_rules (household_id, pattern, category_id)
  select p_household, r.pattern, c.id
  from (values
    ('pagamento de fatura','Pagamento Cartão de Crédito','transferencia'),
    ('pgto fatura','Pagamento Cartão de Crédito','transferencia'),
    ('pag fatura','Pagamento Cartão de Crédito','transferencia'),
    ('fatura paga','Pagamento Cartão de Crédito','transferencia'),
    ('pagamento fatura','Pagamento Cartão de Crédito','transferencia'),
    ('pagto cartao','Pagamento Cartão de Crédito','transferencia'),
    ('pagamento cartao','Pagamento Cartão de Crédito','transferencia'),
    ('supermercado','Mercado','despesa'), ('carrefour','Mercado','despesa'), ('assai','Mercado','despesa'),
    ('atacadao','Mercado','despesa'), ('pao de acucar','Mercado','despesa'), ('hortifruti','Mercado','despesa'),
    ('ifood','Alimentação fora','despesa'), ('uber eats','Alimentação fora','despesa'),
    ('rappi','Alimentação fora','despesa'), ('mcdonalds','Alimentação fora','despesa'),
    ('burger king','Alimentação fora','despesa'), ('restaurante','Alimentação fora','despesa'),
    ('lanchonete','Alimentação fora','despesa'), ('padaria','Alimentação fora','despesa'),
    ('uber','Transporte','despesa'), ('99 ride','Transporte','despesa'), ('99app','Transporte','despesa'),
    ('auto posto','Transporte','despesa'), ('posto','Transporte','despesa'), ('shell','Transporte','despesa'),
    ('ipiranga','Transporte','despesa'), ('estacionamento','Transporte','despesa'),
    ('sem parar','Transporte','despesa'), ('conectcar','Transporte','despesa'),
    ('farmacia','Saúde','despesa'), ('drogaria','Saúde','despesa'), ('drogasil','Saúde','despesa'),
    ('droga raia','Saúde','despesa'), ('pague menos','Saúde','despesa'), ('panvel','Saúde','despesa'),
    ('netflix','Assinaturas','despesa'), ('spotify','Assinaturas','despesa'), ('amazon prime','Assinaturas','despesa'),
    ('disney','Assinaturas','despesa'), ('globoplay','Assinaturas','despesa'),
    ('youtube premium','Assinaturas','despesa'), ('hbo','Assinaturas','despesa'),
    ('enel','Contas da casa','despesa'), ('sabesp','Contas da casa','despesa'), ('comgas','Contas da casa','despesa'),
    ('vivo','Contas da casa','despesa'), ('claro','Contas da casa','despesa'),
    ('dizimo','Igreja e doações','despesa'), ('oferta','Igreja e doações','despesa'),
    ('iof','Impostos e taxas','despesa'), ('tarifa','Impostos e taxas','despesa'), ('anuidade','Impostos e taxas','despesa'),
    ('rendimento','Rendimentos','receita')
  ) as r(pattern, category, kind)
  join public.fin_categories c
    on c.household_id = p_household and c.name = r.category and c.kind = r.kind
  on conflict (household_id, pattern) do nothing;
end;
$$;
revoke execute on function public.seed_fin_defaults(uuid) from public, anon, authenticated;

-- 4) Regras padrão para as famílias existentes --------------------------------
-- Só regras (não recria categorias que a família apagou). Padrão que a família já
-- tem (mesmo apontando para outra categoria) fica como está.
insert into public.fin_rules (household_id, pattern, category_id)
select c.household_id, r.pattern, c.id
from (values
  ('pagamento de fatura','Pagamento Cartão de Crédito','transferencia'),
  ('pgto fatura','Pagamento Cartão de Crédito','transferencia'),
  ('pag fatura','Pagamento Cartão de Crédito','transferencia'),
  ('fatura paga','Pagamento Cartão de Crédito','transferencia'),
  ('pagamento fatura','Pagamento Cartão de Crédito','transferencia'),
  ('pagto cartao','Pagamento Cartão de Crédito','transferencia'),
  ('pagamento cartao','Pagamento Cartão de Crédito','transferencia'),
  ('supermercado','Mercado','despesa'), ('carrefour','Mercado','despesa'), ('assai','Mercado','despesa'),
  ('atacadao','Mercado','despesa'), ('pao de acucar','Mercado','despesa'), ('hortifruti','Mercado','despesa'),
  ('ifood','Alimentação fora','despesa'), ('uber eats','Alimentação fora','despesa'),
  ('rappi','Alimentação fora','despesa'), ('mcdonalds','Alimentação fora','despesa'),
  ('burger king','Alimentação fora','despesa'), ('restaurante','Alimentação fora','despesa'),
  ('lanchonete','Alimentação fora','despesa'), ('padaria','Alimentação fora','despesa'),
  ('uber','Transporte','despesa'), ('99 ride','Transporte','despesa'), ('99app','Transporte','despesa'),
  ('auto posto','Transporte','despesa'), ('posto','Transporte','despesa'), ('shell','Transporte','despesa'),
  ('ipiranga','Transporte','despesa'), ('estacionamento','Transporte','despesa'),
  ('sem parar','Transporte','despesa'), ('conectcar','Transporte','despesa'),
  ('farmacia','Saúde','despesa'), ('drogaria','Saúde','despesa'), ('drogasil','Saúde','despesa'),
  ('droga raia','Saúde','despesa'), ('pague menos','Saúde','despesa'), ('panvel','Saúde','despesa'),
  ('netflix','Assinaturas','despesa'), ('spotify','Assinaturas','despesa'), ('amazon prime','Assinaturas','despesa'),
  ('disney','Assinaturas','despesa'), ('globoplay','Assinaturas','despesa'),
  ('youtube premium','Assinaturas','despesa'), ('hbo','Assinaturas','despesa'),
  ('enel','Contas da casa','despesa'), ('sabesp','Contas da casa','despesa'), ('comgas','Contas da casa','despesa'),
  ('vivo','Contas da casa','despesa'), ('claro','Contas da casa','despesa'),
  ('dizimo','Igreja e doações','despesa'), ('oferta','Igreja e doações','despesa'),
  ('iof','Impostos e taxas','despesa'), ('tarifa','Impostos e taxas','despesa'), ('anuidade','Impostos e taxas','despesa'),
  ('rendimento','Rendimentos','receita')
) as r(pattern, category, kind)
join public.fin_categories c on c.name = r.category and c.kind = r.kind
join public.households h on h.id = c.household_id
on conflict (household_id, pattern) do nothing;

-- 5) Backfill -----------------------------------------------------------------
-- Nada a gravar: as colunas novas entram nulas (category_source null = legado) e
-- transfer_checked = false. Nenhum lançamento existente é alterado.
