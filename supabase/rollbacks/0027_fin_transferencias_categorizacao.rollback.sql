-- Rollback de 0027. Desfaz transferências/categorização em finanças.
-- ATENÇÃO:
-- - Perde-se o pareamento de transferências (transfer_group), as marcas
--   "não é transferência" (transfer_checked), a origem das categorias
--   (category_source) e a categoria da Pluggy (pluggy_category). Os lançamentos
--   e suas categorias continuam.
-- - Remove as regras padrão criadas por 0027 que ainda apontam para a categoria
--   padrão correspondente. Uma regra idêntica (mesmo padrão e mesma categoria)
--   criada pelo usuário depois de 0027 é indistinguível e também será removida.
--   Regras padrão que o usuário redirecionou para outra categoria ficam.
-- - As regras de 0002 ('pagamento de fatura', 'pgto fatura', 'ifood', 'uber',
--   'dizimo') são mantidas.

-- 1) Regras padrão novas (antes de renomear a categoria de volta)
delete from public.fin_rules r
using public.fin_categories c,
  (values
    ('pag fatura','Pagamento Cartão de Crédito','transferencia'),
    ('fatura paga','Pagamento Cartão de Crédito','transferencia'),
    ('pagamento fatura','Pagamento Cartão de Crédito','transferencia'),
    ('pagto cartao','Pagamento Cartão de Crédito','transferencia'),
    ('pagamento cartao','Pagamento Cartão de Crédito','transferencia'),
    ('supermercado','Mercado','despesa'), ('carrefour','Mercado','despesa'), ('assai','Mercado','despesa'),
    ('atacadao','Mercado','despesa'), ('pao de acucar','Mercado','despesa'), ('hortifruti','Mercado','despesa'),
    ('uber eats','Alimentação fora','despesa'),
    ('rappi','Alimentação fora','despesa'), ('mcdonalds','Alimentação fora','despesa'),
    ('burger king','Alimentação fora','despesa'), ('restaurante','Alimentação fora','despesa'),
    ('lanchonete','Alimentação fora','despesa'), ('padaria','Alimentação fora','despesa'),
    ('99 ride','Transporte','despesa'), ('99app','Transporte','despesa'),
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
    ('oferta','Igreja e doações','despesa'),
    ('iof','Impostos e taxas','despesa'), ('tarifa','Impostos e taxas','despesa'), ('anuidade','Impostos e taxas','despesa'),
    ('rendimento','Rendimentos','receita')
  ) as d(pattern, category, kind)
where r.pattern = d.pattern
  and c.id = r.category_id
  and c.household_id = r.household_id
  and c.name = d.category
  and c.kind = d.kind;

-- 2) Nome da categoria de fatura volta ao antigo (onde não houver conflito)
update public.fin_categories c
   set name = 'Pagamento de fatura'
 where c.kind = 'transferencia'
   and c.name = 'Pagamento Cartão de Crédito'
   and not exists (select 1 from public.fin_categories o
                   where o.household_id = c.household_id
                     and o.kind = 'transferencia'
                     and o.name = 'Pagamento de fatura');

-- 3) seed_fin_defaults volta à versão de 0002
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
    ('Pagamento de fatura','transferencia','#8a8d80'), ('Transferência entre contas','transferencia','#8a8d80'),
    ('Aplicação e resgate','transferencia','#8a8d80')
  ) as c(name, kind, color)
  on conflict (household_id, kind, name) do nothing;

  insert into public.fin_rules (household_id, pattern, category_id)
  select p_household, r.pattern, c.id
  from (values
    ('pagamento de fatura', 'Pagamento de fatura'), ('pgto fatura', 'Pagamento de fatura'),
    ('ifood', 'Alimentação fora'), ('uber', 'Transporte'), ('dizimo', 'Igreja e doações')
  ) as r(pattern, category)
  join public.fin_categories c on c.household_id = p_household and c.name = r.category
  on conflict (household_id, pattern) do nothing;
end;
$$;
revoke execute on function public.seed_fin_defaults(uuid) from public, anon, authenticated;

-- 4) Trigger, função, índice e colunas
drop trigger if exists fin_transactions_transfer_guard on public.fin_transactions;
drop function if exists public.fin_transactions_transfer_guard();
drop index if exists public.fin_transactions_transfer_group_idx;
alter table public.fin_transactions
  drop column if exists transfer_group,
  drop column if exists transfer_checked,
  drop column if exists category_source,
  drop column if exists pluggy_category;
