-- Rollback de 0017. Apaga documentos/garantias, cardápio e prestadores (os
-- dados somem; faça backup antes), o vínculo casa_maintenance.provider_id
-- (a coluna texto `provider` de 0015 continua) e a marcação fin_bills.is_home
-- (as contas fixas continuam; só perdem a marca "da casa"), e recria a
-- Despensa vazia (os dados da despensa não voltam; ver abaixo).
--
-- O bucket `casa` e seus arquivos NÃO são apagados por SQL (o Supabase
-- bloqueia delete direto em storage.*): depois do rollback, esvazie e apague o
-- bucket pela API de Storage ou pelo painel. Sem as políticas, nenhum usuário
-- acessa o bucket.
-- Despensa: recriada VAZIA, exatamente como em 0015 (tabela, RLS, políticas,
-- trigger, grants, coluna casa_shopping_items.pantry_item_id com FK composta,
-- índice e índice único parcial). Os dados da despensa e os vínculos das
-- compras NÃO voltam (a 0017 só roda com a despensa vazia).
create table if not exists public.casa_pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  quantity numeric(10,2) not null default 0 check (quantity >= 0),
  min_quantity numeric(10,2) not null default 0 check (min_quantity >= 0),
  unit text check (char_length(unit) <= 20),
  category text check (char_length(category) <= 40),
  location text check (char_length(location) <= 60),
  expires_on date,
  notes text check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_pantry_items_id_household_key unique (id, household_id)
);
create index if not exists casa_pantry_items_household_name_idx on public.casa_pantry_items (household_id, name);

alter table public.casa_shopping_items add column if not exists pantry_item_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'casa_shopping_items_pantry_household_fk') then
    alter table public.casa_shopping_items add constraint casa_shopping_items_pantry_household_fk
      foreign key (pantry_item_id, household_id)
      references public.casa_pantry_items (id, household_id) on delete set null (pantry_item_id);
  end if;
end $$;
create index if not exists casa_shopping_items_pantry_idx on public.casa_shopping_items (pantry_item_id, household_id);
create unique index if not exists casa_shopping_pantry_pending_uq on public.casa_shopping_items (household_id, pantry_item_id)
  where done = false and pantry_item_id is not null;

alter table public.casa_pantry_items enable row level security;
drop policy if exists "casa_pantry_items: membros leem" on public.casa_pantry_items;
drop policy if exists "casa_pantry_items: membros criam" on public.casa_pantry_items;
drop policy if exists "casa_pantry_items: membros editam" on public.casa_pantry_items;
drop policy if exists "casa_pantry_items: membros apagam" on public.casa_pantry_items;
create policy "casa_pantry_items: membros leem" on public.casa_pantry_items for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pantry_items: membros criam" on public.casa_pantry_items for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pantry_items: membros editam" on public.casa_pantry_items for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pantry_items: membros apagam" on public.casa_pantry_items for delete to authenticated
  using ((select public.is_household_member(household_id)));

drop trigger if exists casa_pantry_items_touch on public.casa_pantry_items;
create trigger casa_pantry_items_touch before update on public.casa_pantry_items
  for each row execute function public.casa_touch();

revoke all on public.casa_pantry_items from anon;
revoke truncate, references, trigger on public.casa_pantry_items from authenticated;

drop policy if exists "casa: membros leem arquivos" on storage.objects;
drop policy if exists "casa: membros enviam arquivos" on storage.objects;
drop policy if exists "casa: membros atualizam arquivos" on storage.objects;
drop policy if exists "casa: membros apagam arquivos" on storage.objects;
drop function if exists public.casa_doc_path_household(text);

-- FK, índice e coluna caem juntos com o drop column.
alter table public.casa_maintenance drop column if exists provider_id;

drop table if exists public.casa_providers;
drop table if exists public.casa_meal_plan;
drop table if exists public.casa_documents;
drop function if exists public.casa_meal_plan_check();
-- public.casa_touch é de 0015 e continua em uso: não é removida aqui.

-- O índice parcial fin_bills_household_home_idx cai junto com a coluna.
alter table public.fin_bills drop column if exists is_home;
