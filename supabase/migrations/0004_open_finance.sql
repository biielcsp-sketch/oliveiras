-- Fase 2: Open Finance via Meu Pluggy.
-- Guarda só o itemId (sem credenciais: client_id/secret ficam nas variáveis do servidor)
-- e o vínculo entre contas da Pluggy e contas do app.

create table public.fin_pluggy_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id uuid not null unique,
  label text check (char_length(label) <= 60),
  status text check (char_length(status) <= 40),
  consent_expires_at timestamptz,
  last_sync_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create index fin_pluggy_items_household_idx on public.fin_pluggy_items (household_id);

alter table public.fin_accounts
  add column pluggy_item_ref uuid,
  add column sync_from date,
  add column bank_balance numeric(14,2),
  add column bank_balance_at timestamptz,
  add constraint fin_accounts_pluggy_item_fkey foreign key (pluggy_item_ref, household_id)
    references public.fin_pluggy_items (id, household_id) on delete set null (pluggy_item_ref);
create index fin_accounts_pluggy_item_idx on public.fin_accounts (pluggy_item_ref, household_id);
-- Uma conta da Pluggy vincula no máximo uma conta do app por família.
create unique index fin_accounts_external_idx on public.fin_accounts (household_id, external_id)
  where external_id is not null;

alter table public.fin_pluggy_items enable row level security;
create policy "fin_pluggy_items: família" on public.fin_pluggy_items for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
