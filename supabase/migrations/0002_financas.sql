-- Fase 1a: Finanças — contas, categorias, lançamentos e regras de categorização.
-- Tudo compartilhado dentro da família. Integridade entre famílias garantida por
-- FKs compostas (id, household_id): um lançamento nunca aponta para conta,
-- categoria ou membro de outra família, mesmo que alguém descubra o UUID.

alter table public.members add constraint members_id_household_key unique (id, household_id);

create table public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('corrente', 'poupanca', 'cartao', 'dinheiro', 'investimento')),
  institution text check (char_length(institution) <= 60),
  owner_member_id uuid,
  opening_balance numeric(14,2) not null default 0,
  credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  closing_day smallint check (closing_day between 1 and 31),
  due_day smallint check (due_day between 1 and 31),
  archived boolean not null default false,
  external_id text,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (owner_member_id, household_id)
    references public.members (id, household_id) on delete set null (owner_member_id)
);
create index fin_accounts_household_idx on public.fin_accounts (household_id);

create table public.fin_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('despesa', 'receita', 'transferencia')),
  color text not null default '#8a8d80' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, kind, name)
);

create table public.fin_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null,
  date date not null,
  description text not null check (char_length(description) between 1 and 200),
  amount numeric(14,2) not null check (amount <> 0),
  category_id uuid,
  member_id uuid,
  notes text check (char_length(notes) <= 500),
  source text not null default 'manual' check (source in ('manual', 'ofx', 'csv', 'openfinance')),
  external_id text check (char_length(external_id) <= 120),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (account_id, household_id)
    references public.fin_accounts (id, household_id) on delete cascade,
  foreign key (category_id, household_id)
    references public.fin_categories (id, household_id) on delete set null (category_id),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete set null (member_id)
);
create index fin_transactions_household_date_idx on public.fin_transactions (household_id, date desc);
create index fin_transactions_account_idx on public.fin_transactions (account_id, household_id);
create index fin_transactions_category_idx on public.fin_transactions (category_id, household_id);
create index fin_transactions_member_idx on public.fin_transactions (member_id, household_id);
-- Importação não duplica: mesmo identificador externo na mesma conta é ignorado.
-- (lançamentos manuais têm external_id nulo; nulos não conflitam entre si)
alter table public.fin_transactions
  add constraint fin_transactions_dedup_key unique (account_id, external_id);

create table public.fin_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pattern text not null check (char_length(pattern) between 2 and 60),
  category_id uuid not null,
  created_at timestamptz not null default now(),
  unique (household_id, pattern),
  foreign key (category_id, household_id)
    references public.fin_categories (id, household_id) on delete cascade
);
create index fin_rules_category_idx on public.fin_rules (category_id, household_id);

create index fin_accounts_owner_idx on public.fin_accounts (owner_member_id, household_id);

-- RLS: membros da família fazem tudo; ninguém de fora vê ou escreve.
alter table public.fin_accounts enable row level security;
alter table public.fin_categories enable row level security;
alter table public.fin_transactions enable row level security;
alter table public.fin_rules enable row level security;

create policy "fin_accounts: família" on public.fin_accounts for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "fin_categories: família" on public.fin_categories for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "fin_transactions: família" on public.fin_transactions for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "fin_rules: família" on public.fin_rules for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- Saldos por conta (respeita o RLS de quem consulta).
create view public.fin_account_balances with (security_invoker = true) as
  select a.id as account_id, a.household_id,
         a.opening_balance + coalesce(sum(t.amount), 0) as balance
  from public.fin_accounts a
  left join public.fin_transactions t on t.account_id = a.id
  group by a.id;

-- Categorias e regras padrão de uma família.
create or replace function public.seed_fin_defaults(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fin_categories (household_id, name, kind, color)
  select p_household, c.name, c.kind, c.color
  from (values
    ('Moradia','despesa','#7a6a55'), ('Mercado','despesa','#5b7a3a'), ('Alimentação fora','despesa','#c0703e'),
    ('Transporte','despesa','#4f6d8a'), ('Saúde','despesa','#b4432f'), ('Educação','despesa','#6a5a9a'),
    ('Filho','despesa','#c08a3e'), ('Lazer','despesa','#3e8a8a'), ('Vestuário','despesa','#9a5a7a'),
    ('Assinaturas','despesa','#5a6a7a'), ('Contas da casa','despesa','#8a7a3e'), ('Igreja e doações','despesa','#556b2f'),
    ('Presentes','despesa','#a0605a'), ('Cuidados pessoais','despesa','#8a6a9a'), ('Impostos e taxas','despesa','#6e7066'),
    ('Outros gastos','despesa','#8a8d80'),
    ('Salário','receita','#3f7a4a'), ('Renda extra','receita','#4a8a5a'), ('Reembolso','receita','#5a8a7a'),
    ('Rendimentos','receita','#2f6b55'), ('Outras receitas','receita','#6a8a6a'),
    ('Pagamento de fatura','transferencia','#8a8d80'), ('Transferência entre contas','transferencia','#8a8d80'),
    ('Aplicação e resgate','transferencia','#8a8d80')
  ) as c(name, kind, color)
  on conflict (household_id, kind, name) do nothing;

  insert into public.fin_rules (household_id, pattern, category_id)
  select p_household, r.pattern, c.id
  from (values
    ('pagamento de fatura', 'Pagamento de fatura'), ('pgto fatura', 'Pagamento de fatura'),
    ('ifood', 'Alimentação fora'), ('uber', 'Transporte'), ('dizimo', 'Igreja e doações')
  ) as r(pattern, category)
  join public.fin_categories c on c.household_id = p_household and c.name = r.category
  on conflict (household_id, pattern) do nothing;
end;
$$;
revoke execute on function public.seed_fin_defaults(uuid) from public, anon, authenticated;

-- create_household passa a semear as finanças da nova família.
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
  perform public.seed_fin_defaults(v_hid);
  return v_hid;
end;
$$;

-- Famílias que já existem recebem as categorias padrão.
select public.seed_fin_defaults(id) from public.households;
