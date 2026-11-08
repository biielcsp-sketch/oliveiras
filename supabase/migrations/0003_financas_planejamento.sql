-- Fase 1b: orçamento por categoria, contas a pagar (com vínculo ao lançamento
-- do extrato) e metas medidas pelo saldo de uma conta. Mesmo padrão da 0002:
-- RLS por família e FKs compostas (id, household_id).

-- Orçamento: month nulo = valor padrão que se repete; 'AAAA-MM' = ajuste daquele mês.
create table public.fin_budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null,
  month text check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14,2) not null check (amount >= 0 and amount <= 10000000),
  created_at timestamptz not null default now(),
  unique nulls not distinct (household_id, category_id, month),
  foreign key (category_id, household_id)
    references public.fin_categories (id, household_id) on delete cascade
);
create index fin_budgets_category_idx on public.fin_budgets (category_id, household_id);

-- Contas a pagar recorrentes (mensais).
create table public.fin_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  amount numeric(14,2) not null check (amount > 0 and amount <= 10000000),
  due_day smallint not null check (due_day between 1 and 31),
  category_id uuid,
  account_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (category_id, household_id)
    references public.fin_categories (id, household_id) on delete set null (category_id),
  foreign key (account_id, household_id)
    references public.fin_accounts (id, household_id) on delete set null (account_id)
);
create index fin_bills_household_idx on public.fin_bills (household_id);
create index fin_bills_category_idx on public.fin_bills (category_id, household_id);
create index fin_bills_account_idx on public.fin_bills (account_id, household_id);

-- fin_transactions precisa de (id, household_id) único para a FK composta abaixo.
alter table public.fin_transactions add constraint fin_transactions_id_household_key unique (id, household_id);

-- Pagamento de uma conta num mês, opcionalmente ligado ao lançamento do extrato.
create table public.fin_bill_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bill_id uuid not null,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  transaction_id uuid,
  paid_on date not null,
  amount numeric(14,2) not null check (amount > 0 and amount <= 10000000),
  created_at timestamptz not null default now(),
  unique (bill_id, month),
  -- um lançamento paga no máximo uma conta
  unique (transaction_id),
  foreign key (bill_id, household_id)
    references public.fin_bills (id, household_id) on delete cascade,
  foreign key (transaction_id, household_id)
    references public.fin_transactions (id, household_id) on delete set null (transaction_id)
);
create index fin_bill_payments_bill_idx on public.fin_bill_payments (bill_id, household_id);
create index fin_bill_payments_household_month_idx on public.fin_bill_payments (household_id, month);

create index fin_bill_payments_tx_idx on public.fin_bill_payments (transaction_id, household_id);

-- Metas: progresso = saldo da conta vinculada.
create table public.fin_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  target numeric(14,2) not null check (target > 0 and target <= 100000000),
  account_id uuid,
  target_date date,
  created_at timestamptz not null default now(),
  foreign key (account_id, household_id)
    references public.fin_accounts (id, household_id) on delete set null (account_id)
);
create index fin_goals_household_idx on public.fin_goals (household_id);
create index fin_goals_account_idx on public.fin_goals (account_id, household_id);

-- Índices de FKs apontados pelo advisor de performance.
create index fin_transactions_created_by_idx on public.fin_transactions (created_by);
create index households_created_by_idx on public.households (created_by);
create index members_user_idx on public.members (user_id);

alter table public.fin_budgets enable row level security;
alter table public.fin_bills enable row level security;
alter table public.fin_bill_payments enable row level security;
alter table public.fin_goals enable row level security;

create policy "fin_budgets: família" on public.fin_budgets for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "fin_bills: família" on public.fin_bills for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "fin_bill_payments: família" on public.fin_bill_payments for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "fin_goals: família" on public.fin_goals for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
