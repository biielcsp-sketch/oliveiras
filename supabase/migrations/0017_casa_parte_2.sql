-- Casa (parte 2): contas fixas da casa (fin_bills.is_home), documentos e
-- garantias (com arquivo no bucket privado `casa`), cardápio da semana e
-- prestadores de serviço (ligáveis às manutenções). Dados COMPARTILHADOS pela
-- família: RLS só por família (is_household_member). Mesmo padrão de 0003
-- (FKs compostas (x, household_id)), 0014 (bucket privado + função de caminho)
-- e 0015 (casa_*, casa_touch).
-- Rollback: rollbacks/0017_casa_parte_2.rollback.sql

-- 1) Contas fixas da casa -----------------------------------------------------
-- Aditiva: linhas existentes ficam false. A política de fin_bills (0003) já
-- isola por família, então ler/gravar is_home segue o mesmo isolamento.
alter table public.fin_bills add column is_home boolean not null default false;
create index fin_bills_household_home_idx on public.fin_bills (household_id) where is_home;

-- 2) Documentos e garantias -----------------------------------------------------
-- Arquivo opcional, mas tudo-ou-nada (path, mime e tamanho juntos).
-- Caminho padrão no bucket `casa`: {household_id}/docs/{uuid}.{pdf|jpg}
create table public.casa_documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null default 'garantia'
    check (kind in ('garantia','manual','nota_fiscal','contrato','outro')),
  title text not null check (char_length(title) between 1 and 120),
  product text check (char_length(product) <= 120),
  store text check (char_length(store) <= 120),
  purchase_date date,
  warranty_until date,
  amount numeric(12,2) check (amount >= 0),
  notes text check (char_length(notes) <= 1000),
  file_path text check (char_length(file_path) <= 300),
  file_mime text check (file_mime in ('application/pdf','image/jpeg')),
  file_size int check (file_size between 1 and 5242880),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_documents_id_household_key unique (id, household_id),
  constraint casa_documents_warranty_after_purchase
    check (warranty_until is null or purchase_date is null or warranty_until >= purchase_date),
  constraint casa_documents_file_all_or_nothing
    check ((file_path is null) = (file_mime is null) and (file_mime is null) = (file_size is null))
);
create index casa_documents_household_warranty_idx on public.casa_documents (household_id, warranty_until);
create index casa_documents_created_by_idx on public.casa_documents (created_by);

-- 3) Cardápio -----------------------------------------------------------------
-- Uma refeição por dia/tipo na família. O índice da unique (household_id, day,
-- meal) já atende as consultas por (household_id, day): não há índice duplicado.
create table public.casa_meal_plan (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  day date not null,
  meal text not null check (meal in ('cafe','almoco','lanche','jantar')),
  title text not null check (char_length(title) between 1 and 120),
  ingredients text[] not null default '{}' check (cardinality(ingredients) <= 30),
  notes text check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_meal_plan_household_day_meal_key unique (household_id, day, meal)
);

-- Cada ingrediente: não nulo, 1..80 caracteres; array de uma dimensão.
-- CHECK não aceita subquery, então a validação por item fica num trigger
-- (security invoker, search_path vazio), como casa_chores_check em 0015.
create or replace function public.casa_meal_plan_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if cardinality(new.ingredients) > 0 and (
       array_ndims(new.ingredients) <> 1
       or exists (select 1 from unnest(new.ingredients) as i(item)
                  where i.item is null or char_length(i.item) not between 1 and 80)) then
    raise exception 'casa_meal_plan: ingrediente vazio, nulo ou acima de 80 caracteres'
      using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger casa_meal_plan_check before insert or update on public.casa_meal_plan
  for each row execute function public.casa_meal_plan_check();
revoke execute on function public.casa_meal_plan_check() from public, anon, authenticated;

-- 4) Prestadores ----------------------------------------------------------------
create table public.casa_providers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  service text check (char_length(service) <= 80),
  phone text check (char_length(phone) <= 30 and phone ~ '^[0-9 +()-]+$'),
  email text check (char_length(email) <= 120),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_providers_id_household_key unique (id, household_id)
);
create index casa_providers_household_service_idx on public.casa_providers (household_id, service);

-- 5) Manutenção ligada a prestador (a coluna texto `provider` de 0015 fica) ----
alter table public.casa_maintenance add column provider_id uuid;
alter table public.casa_maintenance add constraint casa_maintenance_provider_household_fk
  foreign key (provider_id, household_id)
  references public.casa_providers (id, household_id) on delete set null (provider_id);
create index casa_maintenance_provider_idx on public.casa_maintenance (provider_id, household_id);

-- 6) RLS (dados compartilhados: qualquer membro da família) -------------------
alter table public.casa_documents enable row level security;
alter table public.casa_meal_plan enable row level security;
alter table public.casa_providers enable row level security;

create policy "casa_documents: membros leem" on public.casa_documents for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_documents: membros criam" on public.casa_documents for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_documents: membros editam" on public.casa_documents for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_documents: membros apagam" on public.casa_documents for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_meal_plan: membros leem" on public.casa_meal_plan for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_meal_plan: membros criam" on public.casa_meal_plan for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_meal_plan: membros editam" on public.casa_meal_plan for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_meal_plan: membros apagam" on public.casa_meal_plan for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_providers: membros leem" on public.casa_providers for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_providers: membros criam" on public.casa_providers for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_providers: membros editam" on public.casa_providers for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_providers: membros apagam" on public.casa_providers for delete to authenticated
  using ((select public.is_household_member(household_id)));

-- 7) updated_at (reaproveita public.casa_touch de 0015) -----------------------
create trigger casa_documents_touch before update on public.casa_documents
  for each row execute function public.casa_touch();
create trigger casa_meal_plan_touch before update on public.casa_meal_plan
  for each row execute function public.casa_touch();
create trigger casa_providers_touch before update on public.casa_providers
  for each row execute function public.casa_touch();

-- 8) Grants ------------------------------------------------------------------
revoke all on public.casa_documents, public.casa_meal_plan, public.casa_providers from anon;
revoke truncate, references, trigger on public.casa_documents, public.casa_meal_plan,
  public.casa_providers from authenticated;

-- 9) Storage: bucket privado `casa` --------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('casa', 'casa', false, 5242880, array['application/pdf','image/jpeg'])
on conflict (id) do nothing;

-- Extrai o household_id do caminho; fora do padrão => null => negado.
-- A regex valida o formato antes do cast, então nunca estoura erro de cast.
create or replace function public.casa_doc_path_household(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/docs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$'
    then split_part(name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.casa_doc_path_household(text) from public, anon;
grant execute on function public.casa_doc_path_household(text) to authenticated;

create policy "casa: membros leem arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'casa' and (select public.is_household_member(public.casa_doc_path_household(name))));
create policy "casa: membros enviam arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'casa' and (select public.is_household_member(public.casa_doc_path_household(name))));
create policy "casa: membros atualizam arquivos" on storage.objects for update to authenticated
  using (bucket_id = 'casa' and (select public.is_household_member(public.casa_doc_path_household(name))))
  with check (bucket_id = 'casa' and (select public.is_household_member(public.casa_doc_path_household(name))));
create policy "casa: membros apagam arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'casa' and (select public.is_household_member(public.casa_doc_path_household(name))));

-- 10) Remoção definitiva da Despensa (decisão do dono) --------------------------
-- Em produção casa_pantry_items está vazia e nenhum item da lista de compras
-- aponta para ela. Trava de segurança: se houver dado, a migração falha em vez
-- de apagar silenciosamente.
do $$
begin
  if exists (select 1 from public.casa_pantry_items)
     or exists (select 1 from public.casa_shopping_items where pantry_item_id is not null) then
    raise exception 'migração 0017 abortada: casa_pantry_items tem linhas ou há compras ligadas à despensa';
  end if;
end $$;

drop index public.casa_shopping_pantry_pending_uq;
alter table public.casa_shopping_items drop constraint casa_shopping_items_pantry_household_fk;
drop index public.casa_shopping_items_pantry_idx;
alter table public.casa_shopping_items drop column pantry_item_id;
-- Políticas, trigger casa_pantry_items_touch, índice e unique caem com a tabela.
-- public.casa_touch continua (usada pelas outras tabelas casa_*).
drop table public.casa_pantry_items;
