-- Agenda: contas Google conectadas, agendas e eventos espelhados do Google Calendar.
-- O refresh token chega ao banco já CRIPTOGRAFADO pelo servidor (AES-GCM);
-- o banco nunca vê o token puro. Isolamento por família via FKs compostas
-- (x, household_id) e RLS com is_household_member.
-- Rollback: rollbacks/0007_agenda.rollback.sql

-- 1) Contas Google -----------------------------------------------------------
create table public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  google_sub text not null check (char_length(google_sub) between 1 and 255),
  email text not null check (char_length(email) <= 320),
  token_ciphertext text not null check (char_length(token_ciphertext) <= 4096),
  scopes text not null,
  status text not null default 'ok' check (status in ('ok','revogado','erro')),
  last_error text check (char_length(last_error) <= 500),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_accounts_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint google_accounts_household_sub_key unique (household_id, google_sub),
  constraint google_accounts_id_household_key unique (id, household_id)
);
create index google_accounts_member_idx on public.google_accounts (member_id, household_id);

alter table public.google_accounts enable row level security;
create policy "google_accounts: membros leem" on public.google_accounts for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "google_accounts: membro conecta a própria conta" on public.google_accounts for insert to authenticated
  with check (
    (select public.is_household_member(household_id))
    and exists (select 1 from public.members m
                where m.id = member_id and m.household_id = google_accounts.household_id
                  and m.user_id = (select auth.uid()))
  );
create policy "google_accounts: membros atualizam" on public.google_accounts for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "google_accounts: dono desconecta" on public.google_accounts for delete to authenticated
  using (
    (select public.is_household_member(household_id))
    and exists (select 1 from public.members m
                where m.id = member_id and m.household_id = google_accounts.household_id
                  and m.user_id = (select auth.uid()))
  );

-- 2) Agendas -----------------------------------------------------------------
create table public.cal_calendars (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_ref uuid not null,
  google_calendar_id text not null check (char_length(google_calendar_id) <= 1024),
  summary text not null check (char_length(summary) <= 300),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  access_role text check (access_role in ('owner','writer','reader','freeBusyReader')),
  selected boolean not null default true,
  sync_token text check (char_length(sync_token) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cal_calendars_account_household_fk foreign key (account_ref, household_id)
    references public.google_accounts (id, household_id) on delete cascade,
  constraint cal_calendars_account_gcal_key unique (account_ref, google_calendar_id),
  constraint cal_calendars_id_household_key unique (id, household_id)
);
create index cal_calendars_household_idx on public.cal_calendars (household_id);
-- (account_ref, google_calendar_id) já indexa account_ref; índice dedicado à FK composta:
create index cal_calendars_account_idx on public.cal_calendars (account_ref, household_id);

alter table public.cal_calendars enable row level security;
create policy "cal_calendars: membros leem" on public.cal_calendars for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "cal_calendars: membros criam" on public.cal_calendars for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "cal_calendars: membros editam" on public.cal_calendars for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "cal_calendars: membros apagam" on public.cal_calendars for delete to authenticated
  using ((select public.is_household_member(household_id)));

-- 3) Eventos -----------------------------------------------------------------
create table public.cal_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  calendar_ref uuid not null,
  google_event_id text not null check (char_length(google_event_id) <= 1024),
  etag text check (char_length(etag) <= 300),
  status text not null default 'confirmed' check (status in ('confirmed','tentative','cancelled')),
  title text not null default '' check (char_length(title) <= 1024),
  description text check (char_length(description) <= 8192),
  location text check (char_length(location) <= 1024),
  all_day boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurring_event_id text check (char_length(recurring_event_id) <= 1024),
  html_link text check (char_length(html_link) <= 2048),
  google_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cal_events_period_check check (ends_at >= starts_at),
  constraint cal_events_calendar_household_fk foreign key (calendar_ref, household_id)
    references public.cal_calendars (id, household_id) on delete cascade,
  constraint cal_events_calendar_gevent_key unique (calendar_ref, google_event_id)
);
create index cal_events_household_starts_idx on public.cal_events (household_id, starts_at);
create index cal_events_calendar_idx on public.cal_events (calendar_ref, household_id);

alter table public.cal_events enable row level security;
create policy "cal_events: membros leem" on public.cal_events for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "cal_events: membros criam" on public.cal_events for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "cal_events: membros editam" on public.cal_events for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "cal_events: membros apagam" on public.cal_events for delete to authenticated
  using ((select public.is_household_member(household_id)));

-- 4) updated_at por trigger (mesmo padrão de oli_memories_touch) --------------
create or replace function public.agenda_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger google_accounts_touch before update on public.google_accounts
  for each row execute function public.agenda_touch();
create trigger cal_calendars_touch before update on public.cal_calendars
  for each row execute function public.agenda_touch();
create trigger cal_events_touch before update on public.cal_events
  for each row execute function public.agenda_touch();
revoke execute on function public.agenda_touch() from public, anon, authenticated;

-- 5) Grants ------------------------------------------------------------------
revoke all on public.google_accounts, public.cal_calendars, public.cal_events from anon;
revoke truncate, references, trigger on public.google_accounts, public.cal_calendars, public.cal_events from authenticated;
-- Dono, família e identidade da conta Google são imutáveis para o app:
-- sem isso o cônjuge poderia trocar member_id para si e então apagar a conta do outro.
revoke update on public.google_accounts from authenticated;
grant update (email, token_ciphertext, scopes, status, last_error, last_sync_at)
  on public.google_accounts to authenticated;
