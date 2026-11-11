-- Casa: aba Pet. Cadastro dos pets da família (pode haver mais de um), vacinas e
-- remédios, veterinário, cuidados recorrentes (banho, tosa...) com histórico,
-- peso e ração. Dados COMPARTILHADOS pela família: RLS só por família
-- (is_household_member). Mesmo padrão de 0015/0017 (casa_*, casa_touch, FKs
-- compostas (x, household_id)) e 0014/0017 (arquivo no bucket privado `casa`).
-- Rollback: rollbacks/0018_casa_pet.rollback.sql

-- 1) Pets -----------------------------------------------------------------------
create table public.casa_pets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  species text not null default 'cachorro' check (species in ('cachorro','gato','outro')),
  breed text check (char_length(breed) <= 60),
  sex text check (sex in ('macho','femea')),
  birth_date date,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_pets_id_household_key unique (id, household_id)
);
create index casa_pets_household_idx on public.casa_pets (household_id);

-- 2) Vacinas e remédios -----------------------------------------------------------
-- Arquivo opcional, tudo-ou-nada. Caminho no bucket `casa`: {household_id}/pets/{uuid}.{pdf|jpg}
create table public.casa_pet_health (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null,
  kind text not null check (kind in ('vacina','vermifugo','antipulgas','remedio')),
  name text not null check (char_length(name) between 1 and 120),
  dose text check (char_length(dose) <= 60),
  applied_on date,
  next_due_on date,
  notes text check (char_length(notes) <= 500),
  file_path text check (char_length(file_path) <= 300),
  file_mime text check (file_mime in ('application/pdf','image/jpeg')),
  file_size int check (file_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_pet_health_pet_household_fk foreign key (pet_id, household_id)
    references public.casa_pets (id, household_id) on delete cascade,
  constraint casa_pet_health_next_after_applied
    check (next_due_on is null or applied_on is null or next_due_on >= applied_on),
  constraint casa_pet_health_file_all_or_nothing
    check ((file_path is null) = (file_mime is null) and (file_mime is null) = (file_size is null))
);
create index casa_pet_health_pet_idx on public.casa_pet_health (pet_id, household_id);
create index casa_pet_health_household_due_idx on public.casa_pet_health (household_id, next_due_on);

-- 3) Veterinário ------------------------------------------------------------------
create table public.casa_pet_vet (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null,
  kind text not null check (kind in ('consulta','exame','receita','outro')),
  happened_on date not null,
  clinic text check (char_length(clinic) <= 120),
  vet text check (char_length(vet) <= 120),
  reason text check (char_length(reason) <= 200),
  notes text check (char_length(notes) <= 2000),
  cost numeric(12,2) check (cost >= 0),
  file_path text check (char_length(file_path) <= 300),
  file_mime text check (file_mime in ('application/pdf','image/jpeg')),
  file_size int check (file_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_pet_vet_pet_household_fk foreign key (pet_id, household_id)
    references public.casa_pets (id, household_id) on delete cascade,
  constraint casa_pet_vet_file_all_or_nothing
    check ((file_path is null) = (file_mime is null) and (file_mime is null) = (file_size is null))
);
create index casa_pet_vet_pet_idx on public.casa_pet_vet (pet_id, household_id, happened_on desc);
create index casa_pet_vet_household_idx on public.casa_pet_vet (household_id);

-- 4) Cuidados recorrentes (banho, tosa...) -----------------------------------------
create table public.casa_pet_care (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  interval_value smallint not null check (interval_value between 1 and 365),
  interval_unit text not null check (interval_unit in ('dias','semanas','meses')),
  last_done_on date,
  next_due_on date,
  provider_id uuid,
  active boolean not null default true,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_pet_care_id_household_key unique (id, household_id),
  constraint casa_pet_care_pet_household_fk foreign key (pet_id, household_id)
    references public.casa_pets (id, household_id) on delete cascade,
  constraint casa_pet_care_provider_household_fk foreign key (provider_id, household_id)
    references public.casa_providers (id, household_id) on delete set null (provider_id)
);
create index casa_pet_care_pet_idx on public.casa_pet_care (pet_id, household_id);
create index casa_pet_care_household_due_idx on public.casa_pet_care (household_id, active, next_due_on);
create index casa_pet_care_provider_idx on public.casa_pet_care (provider_id, household_id);

-- 5) Histórico dos cuidados -----------------------------------------------------------
create table public.casa_pet_care_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  care_id uuid not null,
  done_on date not null,
  cost numeric(12,2) check (cost >= 0),
  notes text check (char_length(notes) <= 500),
  done_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint casa_pet_care_log_care_household_fk foreign key (care_id, household_id)
    references public.casa_pet_care (id, household_id) on delete cascade
);
create index casa_pet_care_log_care_idx on public.casa_pet_care_log (care_id, household_id, done_on desc);
create index casa_pet_care_log_household_idx on public.casa_pet_care_log (household_id);
create index casa_pet_care_log_done_by_idx on public.casa_pet_care_log (done_by);

-- 6) Peso (uma medição por pet por dia) -------------------------------------------------
create table public.casa_pet_weights (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null,
  measured_on date not null,
  weight_kg numeric(5,2) not null check (weight_kg > 0 and weight_kg < 200),
  created_at timestamptz not null default now(),
  constraint casa_pet_weights_pet_day_key unique (pet_id, measured_on),
  constraint casa_pet_weights_pet_household_fk foreign key (pet_id, household_id)
    references public.casa_pets (id, household_id) on delete cascade
);
create index casa_pet_weights_pet_idx on public.casa_pet_weights (pet_id, household_id, measured_on desc);
create index casa_pet_weights_household_idx on public.casa_pet_weights (household_id);

-- 7) Ração ------------------------------------------------------------------------------
create table public.casa_pet_food (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null,
  brand text not null check (char_length(brand) between 1 and 120),
  bag_kg numeric(6,2) not null check (bag_kg > 0 and bag_kg <= 100),
  daily_grams integer check (daily_grams > 0 and daily_grams <= 5000),
  started_on date not null,
  active boolean not null default true,
  notes text check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casa_pet_food_pet_household_fk foreign key (pet_id, household_id)
    references public.casa_pets (id, household_id) on delete cascade
);
create index casa_pet_food_pet_idx on public.casa_pet_food (pet_id, household_id, active);
create index casa_pet_food_household_idx on public.casa_pet_food (household_id);

-- 8) RLS (dados compartilhados: qualquer membro da família) -----------------------------
alter table public.casa_pets enable row level security;
alter table public.casa_pet_health enable row level security;
alter table public.casa_pet_vet enable row level security;
alter table public.casa_pet_care enable row level security;
alter table public.casa_pet_care_log enable row level security;
alter table public.casa_pet_weights enable row level security;
alter table public.casa_pet_food enable row level security;

create policy "casa_pets: membros leem" on public.casa_pets for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pets: membros criam" on public.casa_pets for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pets: membros editam" on public.casa_pets for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pets: membros apagam" on public.casa_pets for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_pet_health: membros leem" on public.casa_pet_health for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pet_health: membros criam" on public.casa_pet_health for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_health: membros editam" on public.casa_pet_health for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_health: membros apagam" on public.casa_pet_health for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_pet_vet: membros leem" on public.casa_pet_vet for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pet_vet: membros criam" on public.casa_pet_vet for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_vet: membros editam" on public.casa_pet_vet for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_vet: membros apagam" on public.casa_pet_vet for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_pet_care: membros leem" on public.casa_pet_care for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pet_care: membros criam" on public.casa_pet_care for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_care: membros editam" on public.casa_pet_care for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_care: membros apagam" on public.casa_pet_care for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_pet_care_log: membros leem" on public.casa_pet_care_log for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pet_care_log: membros criam" on public.casa_pet_care_log for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_care_log: membros editam" on public.casa_pet_care_log for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_care_log: membros apagam" on public.casa_pet_care_log for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_pet_weights: membros leem" on public.casa_pet_weights for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pet_weights: membros criam" on public.casa_pet_weights for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_weights: membros editam" on public.casa_pet_weights for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_weights: membros apagam" on public.casa_pet_weights for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "casa_pet_food: membros leem" on public.casa_pet_food for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "casa_pet_food: membros criam" on public.casa_pet_food for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_food: membros editam" on public.casa_pet_food for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "casa_pet_food: membros apagam" on public.casa_pet_food for delete to authenticated
  using ((select public.is_household_member(household_id)));

-- 9) updated_at (reaproveita public.casa_touch de 0015) --------------------------------
-- casa_pet_care_log e casa_pet_weights não têm updated_at (só created_at).
create trigger casa_pets_touch before update on public.casa_pets
  for each row execute function public.casa_touch();
create trigger casa_pet_health_touch before update on public.casa_pet_health
  for each row execute function public.casa_touch();
create trigger casa_pet_vet_touch before update on public.casa_pet_vet
  for each row execute function public.casa_touch();
create trigger casa_pet_care_touch before update on public.casa_pet_care
  for each row execute function public.casa_touch();
create trigger casa_pet_food_touch before update on public.casa_pet_food
  for each row execute function public.casa_touch();

-- 10) Grants -----------------------------------------------------------------------------
revoke all on public.casa_pets, public.casa_pet_health, public.casa_pet_vet, public.casa_pet_care,
  public.casa_pet_care_log, public.casa_pet_weights, public.casa_pet_food from anon;
revoke truncate, references, trigger on public.casa_pets, public.casa_pet_health, public.casa_pet_vet,
  public.casa_pet_care, public.casa_pet_care_log, public.casa_pet_weights, public.casa_pet_food
  from authenticated;

-- 11) Storage: bucket `casa` passa a aceitar a pasta pets/ ------------------------------
-- Caminhos aceitos: {household_id}/docs/{uuid}.{pdf|jpg} e {household_id}/pets/{uuid}.{pdf|jpg}.
-- A regex valida o formato antes do cast (nunca estoura erro de cast). As 4
-- políticas de storage.objects do bucket `casa` (0017) não mudam: chamam esta função.
-- create or replace preserva o ACL; revoke/grant repetidos por clareza (idempotentes).
create or replace function public.casa_doc_path_household(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(docs|pets)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$'
    then split_part(name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.casa_doc_path_household(text) from public, anon;
grant execute on function public.casa_doc_path_household(text) to authenticated;
