-- Saúde: exames de laboratório (relatório + resultados por biomarcador).
-- Dados COMPARTILHADOS entre os adultos da família (RLS por is_household_member,
-- padrão 0010). PDF/JPEG no bucket `saude` já existente (sem bucket novo).
-- Rollback: rollbacks/0025_saude_exames_lab.rollback.sql

create table public.health_lab_reports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  collected_on date not null,
  lab text check (char_length(lab) <= 120),
  file_path text check (char_length(file_path) <= 300),
  file_mime text check (file_mime in ('application/pdf','image/jpeg')),
  file_size int check (file_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_lab_reports_id_household_key unique (id, household_id),
  constraint health_lab_reports_id_member_household_key unique (id, member_id, household_id),
  constraint health_lab_reports_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint health_lab_reports_file_all_or_none check (
    (file_path is null and file_mime is null and file_size is null)
    or (file_path is not null and file_mime is not null and file_size is not null))
);
create index health_lab_reports_household_date_idx on public.health_lab_reports (household_id, collected_on);
create index health_lab_reports_member_idx on public.health_lab_reports (member_id, household_id);

create table public.health_lab_results (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  biomarker_key text not null check (char_length(biomarker_key) between 1 and 80),
  name text not null check (char_length(name) between 1 and 160),
  category text not null check (category in ('cardiovascular','metabolismo','rins','sangue','tireoide','imunidade','vitaminas_minerais','hormonios','figado','urina','outros')),
  value_num numeric,
  value_text text check (char_length(value_text) <= 120),
  unit text check (char_length(unit) <= 30),
  ref_min numeric,
  ref_max numeric,
  ref_text text check (char_length(ref_text) <= 200),
  created_at timestamptz not null default now(),
  constraint health_lab_results_value_check check (value_num is not null or value_text is not null),
  constraint health_lab_results_report_biomarker_key unique (report_id, biomarker_key),
  -- Cobre também (report_id, household_id): o resultado herda família e membro do relatório.
  constraint health_lab_results_report_fk foreign key (report_id, member_id, household_id)
    references public.health_lab_reports (id, member_id, household_id) on delete cascade,
  constraint health_lab_results_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index health_lab_results_member_biomarker_idx on public.health_lab_results (member_id, biomarker_key);
create index health_lab_results_household_idx on public.health_lab_results (household_id);

alter table public.health_lab_reports enable row level security;
alter table public.health_lab_results enable row level security;

create policy "health_lab_reports: membros leem" on public.health_lab_reports for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_lab_reports: membros criam" on public.health_lab_reports for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_lab_reports: membros editam" on public.health_lab_reports for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_lab_reports: membros apagam" on public.health_lab_reports for delete to authenticated
  using ((select public.is_household_member(household_id)));

create policy "health_lab_results: membros leem" on public.health_lab_results for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "health_lab_results: membros criam" on public.health_lab_results for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "health_lab_results: membros editam" on public.health_lab_results for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "health_lab_results: membros apagam" on public.health_lab_results for delete to authenticated
  using ((select public.is_household_member(household_id)));

create trigger health_lab_reports_touch before update on public.health_lab_reports
  for each row execute function public.saude_touch();

revoke all on public.health_lab_reports, public.health_lab_results from anon;
revoke truncate, references, trigger on public.health_lab_reports, public.health_lab_results from authenticated;
