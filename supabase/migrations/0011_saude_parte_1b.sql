-- Saúde (parte 1b): procedimentos, medicamentos e vacinas. Dados COMPARTILHADOS
-- entre os adultos da família: RLS só por família (is_household_member), FKs
-- compostas (member_id, household_id) como em 0010. Procedimentos e vacinas
-- aceitam arquivo opcional (PDF/JPEG) no bucket `saude`.
-- Rollback: rollbacks/0011_saude_parte_1b.rollback.sql

-- 1) Procedimentos -----------------------------------------------------------
create table public.health_procedures (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  performed_on date,
  place text check (char_length(place) <= 200),
  doctor text check (char_length(doctor) <= 120),
  notes text check (char_length(notes) <= 2000),
  file_path text check (char_length(file_path) <= 300),
  file_mime text check (file_mime in ('application/pdf','image/jpeg')),
  file_size int check (file_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_procedures_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint health_procedures_file_all_or_none check (
    (file_path is null and file_mime is null and file_size is null)
    or (file_path is not null and file_mime is not null and file_size is not null))
);
create index health_procedures_household_date_idx on public.health_procedures (household_id, performed_on);
create index health_procedures_member_idx on public.health_procedures (member_id, household_id);

-- 2) Medicamentos ------------------------------------------------------------
create table public.health_medications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  dosage text check (char_length(dosage) <= 120),
  frequency text check (char_length(frequency) <= 200),
  started_on date,
  ended_on date,
  active boolean not null default true,
  prescribed_by text check (char_length(prescribed_by) <= 120),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_medications_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint health_medications_dates_check check (ended_on is null or started_on is null or ended_on >= started_on)
);
create index health_medications_household_active_idx on public.health_medications (household_id, active);
create index health_medications_member_idx on public.health_medications (member_id, household_id);

-- 3) Vacinas -----------------------------------------------------------------
create table public.health_vaccines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  dose_label text check (char_length(dose_label) <= 60),
  applied_on date,
  next_dose_on date,
  place text check (char_length(place) <= 200),
  lot text check (char_length(lot) <= 60),
  notes text check (char_length(notes) <= 1000),
  file_path text check (char_length(file_path) <= 300),
  file_mime text check (file_mime in ('application/pdf','image/jpeg')),
  file_size int check (file_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_vaccines_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint health_vaccines_file_all_or_none check (
    (file_path is null and file_mime is null and file_size is null)
    or (file_path is not null and file_mime is not null and file_size is not null))
);
create index health_vaccines_household_applied_idx on public.health_vaccines (household_id, applied_on);
create index health_vaccines_member_idx on public.health_vaccines (member_id, household_id);

-- 4) RLS ---------------------------------------------------------------------
alter table public.health_procedures enable row level security;
alter table public.health_medications enable row level security;
alter table public.health_vaccines enable row level security;

create policy "health_procedures: membros leem" on public.health_procedures for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_procedures: membros criam" on public.health_procedures for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_procedures: membros editam" on public.health_procedures for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_procedures: membros apagam" on public.health_procedures for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "health_medications: membros leem" on public.health_medications for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_medications: membros criam" on public.health_medications for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_medications: membros editam" on public.health_medications for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_medications: membros apagam" on public.health_medications for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "health_vaccines: membros leem" on public.health_vaccines for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_vaccines: membros criam" on public.health_vaccines for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_vaccines: membros editam" on public.health_vaccines for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_vaccines: membros apagam" on public.health_vaccines for delete to authenticated
  using ((select public.is_household_member(household_id)));

-- 5) updated_at (reusa public.saude_touch de 0010) ------------------------------
create trigger health_procedures_touch before update on public.health_procedures
  for each row execute function public.saude_touch();
create trigger health_medications_touch before update on public.health_medications
  for each row execute function public.saude_touch();
create trigger health_vaccines_touch before update on public.health_vaccines
  for each row execute function public.saude_touch();

-- 6) Grants ------------------------------------------------------------------
revoke all on public.health_procedures, public.health_medications, public.health_vaccines from anon;
revoke truncate, references, trigger on public.health_procedures, public.health_medications, public.health_vaccines from authenticated;

-- 7) Storage: caminho agora aceita procedures e vaccines ----------------------
-- {household_id}/{cards|exams|procedures|vaccines}/{uuid}.{pdf|jpg}
-- create or replace mantém grants (authenticated sim; public/anon não); repetidos por segurança.
create or replace function public.saude_path_household(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(cards|exams|procedures|vaccines)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.saude_path_household(text) from public, anon;
grant execute on function public.saude_path_household(text) to authenticated;
