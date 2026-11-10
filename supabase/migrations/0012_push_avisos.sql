-- Avisos por notificação push (Web Push) da Saúde: assinaturas do navegador,
-- log de envios (só service role do Edge Function) e horários de lembrete dos
-- medicamentos. Aditiva: nada existente é alterado além de uma coluna com default.
-- Rollback: rollbacks/0012_push_avisos.rollback.sql

-- 1) Assinaturas push --------------------------------------------------------
-- Cada pessoa só enxerga e gerencia as PRÓPRIAS assinaturas (nem o cônjuge vê).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique
    check (endpoint like 'https://%' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) <= 255),
  auth text not null check (char_length(auth) <= 255),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_subscriptions_household_idx on public.push_subscriptions (household_id);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: dono lê" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "push_subscriptions: dono cria" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "push_subscriptions: dono edita" on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_household_member(household_id)))
  with check (user_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "push_subscriptions: dono apaga" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_household_member(household_id)));

revoke all on public.push_subscriptions from anon;
revoke truncate, references, trigger on public.push_subscriptions from authenticated;

-- 2) Log de envios (deduplicação do Edge Function) -----------------------------
-- RLS ligado e SEM políticas; sem grants para anon/authenticated. Só o service role.
create table public.push_dispatch_log (
  key text primary key,
  sent_at timestamptz not null default now()
);
create index push_dispatch_log_sent_at_idx on public.push_dispatch_log (sent_at);
alter table public.push_dispatch_log enable row level security;
revoke all on public.push_dispatch_log from anon, authenticated;

-- 3) Horários de lembrete dos medicamentos -------------------------------------
-- Até 6 horários HH:MM (24h). CHECK não aceita subquery: valida o array inteiro
-- como texto (itens separados por vírgula casando HH:MM) e exige que cada item
-- tenha exatamente 5 caracteres (barra item vazio e item com vírgula embutida) e
-- que não haja NULL.
alter table public.health_medications
  add column reminder_times text[] not null default '{}',
  add constraint health_medications_reminder_times_check check (
    cardinality(reminder_times) <= 6
    and array_position(reminder_times, null) is null
    and array_to_string(reminder_times, ',') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9](,|$))*$'
    and char_length(array_to_string(reminder_times, '')) = 5 * cardinality(reminder_times)
  );
