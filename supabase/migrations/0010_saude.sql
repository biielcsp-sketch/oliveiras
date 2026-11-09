-- Saúde (parte 1a): carteirinhas de plano, consultas/retornos e exames, com
-- arquivos (PDF/JPEG) no bucket privado `saude`. Dados COMPARTILHADOS entre os
-- adultos da família: RLS só por família (is_household_member). Isolamento por
-- FKs compostas (x, household_id), como em 0006/0007.
-- Rollback: rollbacks/0010_saude.rollback.sql

-- 1) Carteirinhas ------------------------------------------------------------
create table public.health_insurance_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  operator text not null check (char_length(operator) between 1 and 120),
  card_number text check (char_length(card_number) <= 60),
  plan_name text check (char_length(plan_name) <= 120),
  valid_until date,
  notes text check (char_length(notes) <= 500),
  file_path text not null check (char_length(file_path) <= 300),
  file_mime text not null check (file_mime in ('application/pdf','image/jpeg')),
  file_size int not null check (file_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_insurance_cards_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index health_insurance_cards_household_idx on public.health_insurance_cards (household_id);
create index health_insurance_cards_member_idx on public.health_insurance_cards (member_id, household_id);

-- 2) Consultas e retornos ----------------------------------------------------
create table public.health_appointments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  kind text not null default 'consulta' check (kind in ('consulta','retorno')),
  specialty text check (char_length(specialty) <= 120),
  doctor text check (char_length(doctor) <= 120),
  place text check (char_length(place) <= 200),
  starts_at timestamptz not null,
  status text not null default 'agendada' check (status in ('agendada','realizada','cancelada')),
  notes text check (char_length(notes) <= 1000),
  return_of uuid,
  -- id do evento criado na Agenda (cal_events.id). Sem FK de propósito:
  -- o evento pode ser apagado fora da Saúde.
  agenda_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_appointments_id_household_key unique (id, household_id),
  constraint health_appointments_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint health_appointments_return_of_fk foreign key (return_of, household_id)
    references public.health_appointments (id, household_id) on delete set null (return_of)
);
create index health_appointments_household_starts_idx on public.health_appointments (household_id, starts_at);
create index health_appointments_member_idx on public.health_appointments (member_id, household_id);
create index health_appointments_return_of_idx on public.health_appointments (return_of, household_id);

-- 3) Exames ------------------------------------------------------------------
create table public.health_exams (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  exam_date date,
  lab text check (char_length(lab) <= 120),
  requested_by text check (char_length(requested_by) <= 120),
  result_summary text check (char_length(result_summary) <= 2000),
  file_path text check (char_length(file_path) <= 300),
  file_mime text check (file_mime in ('application/pdf','image/jpeg')),
  file_size int check (file_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_exams_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint health_exams_file_all_or_none check (
    (file_path is null and file_mime is null and file_size is null)
    or (file_path is not null and file_mime is not null and file_size is not null))
);
create index health_exams_household_date_idx on public.health_exams (household_id, exam_date);
create index health_exams_member_idx on public.health_exams (member_id, household_id);

-- 4) RLS (dados compartilhados: qualquer membro da família) -------------------
alter table public.health_insurance_cards enable row level security;
alter table public.health_appointments enable row level security;
alter table public.health_exams enable row level security;

create policy "health_insurance_cards: membros leem" on public.health_insurance_cards for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_insurance_cards: membros criam" on public.health_insurance_cards for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_insurance_cards: membros editam" on public.health_insurance_cards for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_insurance_cards: membros apagam" on public.health_insurance_cards for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "health_appointments: membros leem" on public.health_appointments for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_appointments: membros criam" on public.health_appointments for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_appointments: membros editam" on public.health_appointments for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_appointments: membros apagam" on public.health_appointments for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "health_exams: membros leem" on public.health_exams for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_exams: membros criam" on public.health_exams for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_exams: membros editam" on public.health_exams for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_exams: membros apagam" on public.health_exams for delete to authenticated
  using ((select public.is_household_member(household_id)));

-- 5) updated_at por trigger (mesmo padrão de agenda_touch) --------------------
create or replace function public.saude_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger health_insurance_cards_touch before update on public.health_insurance_cards
  for each row execute function public.saude_touch();
create trigger health_appointments_touch before update on public.health_appointments
  for each row execute function public.saude_touch();
create trigger health_exams_touch before update on public.health_exams
  for each row execute function public.saude_touch();
revoke execute on function public.saude_touch() from public, anon, authenticated;

-- 6) Grants ------------------------------------------------------------------
revoke all on public.health_insurance_cards, public.health_appointments, public.health_exams from anon;
revoke truncate, references, trigger on public.health_insurance_cards, public.health_appointments, public.health_exams from authenticated;

-- 7) Storage: bucket privado `saude` -----------------------------------------
-- Caminho padrão: {household_id}/{cards|exams}/{uuid}.{pdf|jpg}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('saude', 'saude', false, 5242880, array['application/pdf','image/jpeg'])
on conflict (id) do nothing;

-- Extrai o household_id do caminho; caminho fora do padrão (ou uuid inválido) => null => negado.
-- A regex garante o formato antes do cast, então nunca estoura erro de cast.
create or replace function public.saude_path_household(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(cards|exams)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.saude_path_household(text) from public, anon;
grant execute on function public.saude_path_household(text) to authenticated;

create policy "saude: membros leem arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'saude' and (select public.is_household_member(public.saude_path_household(name))));
create policy "saude: membros enviam arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'saude' and (select public.is_household_member(public.saude_path_household(name))));
create policy "saude: membros atualizam arquivos" on storage.objects for update to authenticated
  using (bucket_id = 'saude' and (select public.is_household_member(public.saude_path_household(name))))
  with check (bucket_id = 'saude' and (select public.is_household_member(public.saude_path_household(name))));
create policy "saude: membros apagam arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'saude' and (select public.is_household_member(public.saude_path_household(name))));
