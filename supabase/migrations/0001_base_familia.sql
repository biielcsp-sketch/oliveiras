-- Fase 0: família, usuários e membros (inclui dependentes sem login)

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.household_users (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_users_user_idx on public.household_users(user_id);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  relation text not null default 'outro'
    check (relation in ('titular', 'conjuge', 'filho', 'outro')),
  birth_date date,
  color text not null default '#5B6B3A',
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);
create index members_household_idx on public.members(household_id);

-- Helper: o usuário atual pertence à família?
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_users hu
    where hu.household_id = hid and hu.user_id = (select auth.uid())
  );
$$;

alter table public.households enable row level security;
alter table public.household_users enable row level security;
alter table public.members enable row level security;

create policy "households: membros leem" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "households: membros editam" on public.households
  for update to authenticated using (public.is_household_member(id))
  with check (public.is_household_member(id));

create policy "household_users: membros leem" on public.household_users
  for select to authenticated using (public.is_household_member(household_id));

create policy "members: membros leem" on public.members
  for select to authenticated using (public.is_household_member(household_id));
create policy "members: membros criam" on public.members
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "members: membros editam" on public.members
  for update to authenticated using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "members: membros removem dependentes" on public.members
  for delete to authenticated
  using (public.is_household_member(household_id) and user_id is null);

-- Criar família (cria família + vínculo + membro titular de uma vez)
create or replace function public.create_household(p_name text, p_member_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hid uuid;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  if exists (select 1 from public.household_users where user_id = v_uid) then
    raise exception 'usuário já pertence a uma família';
  end if;

  insert into public.households (name, created_by) values (trim(p_name), v_uid)
  returning id into v_hid;
  insert into public.household_users (household_id, user_id, role) values (v_hid, v_uid, 'owner');
  insert into public.members (household_id, user_id, name, relation)
  values (v_hid, v_uid, trim(p_member_name), 'titular');
  return v_hid;
end;
$$;

-- Entrar numa família pelo código de convite
create or replace function public.join_household(p_code text, p_member_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hid uuid;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  if exists (select 1 from public.household_users where user_id = v_uid) then
    raise exception 'usuário já pertence a uma família';
  end if;

  select id into v_hid from public.households where invite_code = upper(trim(p_code));
  if v_hid is null then raise exception 'código inválido'; end if;

  insert into public.household_users (household_id, user_id, role) values (v_hid, v_uid, 'member');
  insert into public.members (household_id, user_id, name, relation)
  values (v_hid, v_uid, trim(p_member_name), 'conjuge');
  return v_hid;
end;
$$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household(text, text) from public, anon;
revoke execute on function public.is_household_member(uuid) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
