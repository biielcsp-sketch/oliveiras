-- Casa (parte 1): lista de compras, despensa, tarefas domésticas com rodízio e
-- manutenções da casa. Dados COMPARTILHADOS pela família: RLS só por família
-- (is_household_member). Isolamento por FKs compostas (x, household_id), como
-- em 0010/0011. Cálculo de próxima data/rodízio fica nas server actions; o banco
-- só garante integridade.
-- Rollback: rollbacks/0015_casa_parte_1.rollback.sql

-- 1) Despensa (criada antes da lista de compras, que aponta para ela) --------
create table public.casa_pantry_items (
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
create index casa_pantry_items_household_name_idx on public.casa_pantry_items (household_id, name);

-- 2) Lista de compras --------------------------------------------------------
create table public.casa_shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  quantity numeric(10,2) check (quantity > 0),
  unit text check (char_length(unit) <= 20),
  category text check (char_length(category) <= 40),
  notes text check (char_length(notes) <= 300),
  done boolean not null default false,
  done_at timestamptz,
  pantry_item_id uuid,
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_shopping_items_pantry_household_fk foreign key (pantry_item_id, household_id)
    references public.casa_pantry_items (id, household_id) on delete set null (pantry_item_id)
);
create index casa_shopping_items_household_done_idx on public.casa_shopping_items (household_id, done, created_at desc);
create index casa_shopping_items_pantry_idx on public.casa_shopping_items (pantry_item_id, household_id);
create index casa_shopping_items_added_by_idx on public.casa_shopping_items (added_by);
-- Impede o mesmo item da despensa pendente duas vezes na lista (dois celulares ao mesmo tempo).
create unique index casa_shopping_pantry_pending_uq on public.casa_shopping_items (household_id, pantry_item_id)
  where done = false and pantry_item_id is not null;

-- 3) Tarefas domésticas ------------------------------------------------------
-- rotation: ids de public.members da MESMA família, na ordem do rodízio (pode
-- repetir pessoa). Validado por trigger (FK não funciona em array).
create table public.casa_chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  notes text check (char_length(notes) <= 500),
  frequency text not null check (frequency in ('diaria','semanal','mensal')),
  weekdays smallint[] check (
    weekdays is null
    or (cardinality(weekdays) between 1 and 7 and weekdays <@ '{0,1,2,3,4,5,6}'::smallint[])),
  month_day smallint check (month_day between 1 and 31),
  rotation uuid[] not null default '{}' check (cardinality(rotation) <= 10),
  next_index smallint not null default 0 check (next_index >= 0),
  next_due_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_chores_id_household_key unique (id, household_id),
  constraint casa_chores_weekdays_semanal check (weekdays is null or frequency = 'semanal'),
  constraint casa_chores_month_day_mensal check (month_day is null or frequency = 'mensal')
);
create index casa_chores_household_due_idx on public.casa_chores (household_id, active, next_due_on);

-- Integridade do rodízio e dos dias da semana. Roda com a sessão do usuário
-- (security invoker): só enxerga members da própria família pelo RLS.
create or replace function public.casa_chores_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.weekdays is not null
     and (select count(distinct d) from unnest(new.weekdays) as d) <> cardinality(new.weekdays) then
    raise exception 'casa_chores: weekdays com dia repetido' using errcode = '23514';
  end if;

  if cardinality(new.rotation) > 0 and new.next_index >= cardinality(new.rotation) then
    raise exception 'casa_chores: next_index fora do rodízio' using errcode = '23514';
  end if;

  -- Membros só são revalidados quando o rodízio ou a família mudam: assim,
  -- avançar next_index não falha se um membro foi removido depois.
  if tg_op = 'INSERT' or new.rotation is distinct from old.rotation
     or new.household_id is distinct from old.household_id then
    if exists (
      select 1 from unnest(new.rotation) as r(member_id)
      where r.member_id is null
         or not exists (select 1 from public.members m
                        where m.id = r.member_id and m.household_id = new.household_id)
    ) then
      raise exception 'casa_chores: rodízio com membro que não é da família' using errcode = '23503';
    end if;
  end if;
  return new;
end; $$;
create trigger casa_chores_check before insert or update on public.casa_chores
  for each row execute function public.casa_chores_check();
revoke execute on function public.casa_chores_check() from public, anon, authenticated;

-- 4) Histórico de tarefas ----------------------------------------------------
create table public.casa_chore_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  chore_id uuid not null,
  member_id uuid,
  done_on date not null,
  done_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint casa_chore_log_chore_household_fk foreign key (chore_id, household_id)
    references public.casa_chores (id, household_id) on delete cascade,
  constraint casa_chore_log_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete set null (member_id)
);
create index casa_chore_log_chore_idx on public.casa_chore_log (chore_id, household_id, done_on desc);
create index casa_chore_log_member_idx on public.casa_chore_log (member_id, household_id);
create index casa_chore_log_household_idx on public.casa_chore_log (household_id);
create index casa_chore_log_done_by_idx on public.casa_chore_log (done_by);

-- 5) Manutenções -------------------------------------------------------------
create table public.casa_maintenance (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  notes text check (char_length(notes) <= 500),
  interval_value smallint not null check (interval_value between 1 and 365),
  interval_unit text not null check (interval_unit in ('dias','semanas','meses','anos')),
  last_done_on date,
  next_due_on date,
  provider text check (char_length(provider) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_maintenance_id_household_key unique (id, household_id)
);
create index casa_maintenance_household_due_idx on public.casa_maintenance (household_id, active, next_due_on);

-- 6) Histórico de manutenções ------------------------------------------------
create table public.casa_maintenance_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  maintenance_id uuid not null,
  done_on date not null,
  cost numeric(12,2) check (cost >= 0),
  notes text check (char_length(notes) <= 500),
  done_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint casa_maintenance_log_maintenance_household_fk foreign key (maintenance_id, household_id)
    references public.casa_maintenance (id, household_id) on delete cascade
);
create index casa_maintenance_log_maintenance_idx on public.casa_maintenance_log (maintenance_id, household_id, done_on desc);
create index casa_maintenance_log_household_idx on public.casa_maintenance_log (household_id);
create index casa_maintenance_log_done_by_idx on public.casa_maintenance_log (done_by);

-- 7) RLS (dados compartilhados: qualquer membro da família) -------------------
alter table public.casa_pantry_items enable row level security;
alter table public.casa_shopping_items enable row level security;
alter table public.casa_chores enable row level security;
alter table public.casa_chore_log enable row level security;
alter table public.casa_maintenance enable row level security;
alter table public.casa_maintenance_log enable row level security;

create policy "casa_pantry_items: membros leem" on public.casa_pantry_items for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pantry_items: membros criam" on public.casa_pantry_items for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pantry_items: membros editam" on public.casa_pantry_items for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pantry_items: membros apagam" on public.casa_pantry_items for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_shopping_items: membros leem" on public.casa_shopping_items for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_shopping_items: membros criam" on public.casa_shopping_items for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_shopping_items: membros editam" on public.casa_shopping_items for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_shopping_items: membros apagam" on public.casa_shopping_items for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_chores: membros leem" on public.casa_chores for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_chores: membros criam" on public.casa_chores for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_chores: membros editam" on public.casa_chores for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_chores: membros apagam" on public.casa_chores for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_chore_log: membros leem" on public.casa_chore_log for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_chore_log: membros criam" on public.casa_chore_log for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_chore_log: membros editam" on public.casa_chore_log for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_chore_log: membros apagam" on public.casa_chore_log for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_maintenance: membros leem" on public.casa_maintenance for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_maintenance: membros criam" on public.casa_maintenance for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_maintenance: membros editam" on public.casa_maintenance for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_maintenance: membros apagam" on public.casa_maintenance for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_maintenance_log: membros leem" on public.casa_maintenance_log for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_maintenance_log: membros criam" on public.casa_maintenance_log for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_maintenance_log: membros editam" on public.casa_maintenance_log for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_maintenance_log: membros apagam" on public.casa_maintenance_log for delete to authenticated
  using ((select public.is_household_member(household_id)));

-- 8) updated_at por trigger ---------------------------------------------------
create or replace function public.casa_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger casa_pantry_items_touch before update on public.casa_pantry_items
  for each row execute function public.casa_touch();
create trigger casa_shopping_items_touch before update on public.casa_shopping_items
  for each row execute function public.casa_touch();
create trigger casa_chores_touch before update on public.casa_chores
  for each row execute function public.casa_touch();
create trigger casa_maintenance_touch before update on public.casa_maintenance
  for each row execute function public.casa_touch();
revoke execute on function public.casa_touch() from public, anon, authenticated;

-- 9) Grants ------------------------------------------------------------------
revoke all on public.casa_pantry_items, public.casa_shopping_items, public.casa_chores,
  public.casa_chore_log, public.casa_maintenance, public.casa_maintenance_log from anon;
revoke truncate, references, trigger on public.casa_pantry_items, public.casa_shopping_items,
  public.casa_chores, public.casa_chore_log, public.casa_maintenance, public.casa_maintenance_log
  from authenticated;
