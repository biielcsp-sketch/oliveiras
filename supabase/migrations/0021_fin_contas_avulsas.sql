-- Finanças: contas avulsas (pagas uma vez só), ao lado das contas fixas (fin_bills).
-- 1) fin_one_off_bills: a conta e o pagamento na própria linha (paid_on,
--    transaction_id, paid_auto), já que não há meses a controlar.
-- 2) fin_documents.one_off_bill_id: o boleto/comprovante pode apontar para uma
--    avulsa, nunca para fixa e avulsa ao mesmo tempo.
-- 3) fin_one_off_baixa_dismissals: recusas ("não é") e baixas desfeitas do par
--    avulsa x lançamento. Tabela separada de fin_baixa_dismissals para não mexer
--    no bill_id not null nem no unique atual (o código das fixas segue igual).
-- Mesmo padrão de 0003/0014/0016: RLS por família e FKs compostas (x, household_id).
-- Rollback: rollbacks/0021_fin_contas_avulsas.rollback.sql

-- 1) Contas avulsas -----------------------------------------------------------
create table public.fin_one_off_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  amount numeric(14,2) not null check (amount > 0 and amount <= 10000000),
  due_date date not null,
  category_id uuid,
  account_id uuid,
  is_home boolean not null default false,
  paid_on date,
  transaction_id uuid,
  paid_auto boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fin_one_off_bills_id_household_key unique (id, household_id),
  -- pago (lançamento ligado ou baixa automática) exige a data do pagamento
  constraint fin_one_off_bills_paid_coherent check (
    paid_on is not null or (transaction_id is null and paid_auto = false)),
  constraint fin_one_off_bills_category_household_fk foreign key (category_id, household_id)
    references public.fin_categories (id, household_id) on delete set null (category_id),
  constraint fin_one_off_bills_account_household_fk foreign key (account_id, household_id)
    references public.fin_accounts (id, household_id) on delete set null (account_id),
  constraint fin_one_off_bills_transaction_household_fk foreign key (transaction_id, household_id)
    references public.fin_transactions (id, household_id) on delete set null (transaction_id)
);
-- Lista do mês (Finanças) e da casa (Casa > Contas) pelo vencimento.
create index fin_one_off_bills_household_due_idx on public.fin_one_off_bills (household_id, due_date);
create index fin_one_off_bills_category_idx on public.fin_one_off_bills (category_id, household_id);
create index fin_one_off_bills_account_idx on public.fin_one_off_bills (account_id, household_id);
create index fin_one_off_bills_transaction_idx on public.fin_one_off_bills (transaction_id, household_id);
create index fin_one_off_bills_created_by_idx on public.fin_one_off_bills (created_by);
-- Um lançamento paga no máximo uma avulsa.
create unique index fin_one_off_bills_transaction_uq on public.fin_one_off_bills (transaction_id)
  where transaction_id is not null;

alter table public.fin_one_off_bills enable row level security;

create policy "fin_one_off_bills: membros leem" on public.fin_one_off_bills for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "fin_one_off_bills: membros criam" on public.fin_one_off_bills for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "fin_one_off_bills: membros editam" on public.fin_one_off_bills for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "fin_one_off_bills: membros apagam" on public.fin_one_off_bills for delete to authenticated
  using ((select public.is_household_member(household_id)));

revoke all on public.fin_one_off_bills from anon;
revoke truncate, references, trigger on public.fin_one_off_bills from authenticated;

-- 2) Documento ligado a uma avulsa -------------------------------------------
-- Coluna nula e check novo: linhas existentes já satisfazem (one_off_bill_id nulo).
alter table public.fin_documents add column one_off_bill_id uuid;
alter table public.fin_documents add constraint fin_documents_one_off_bill_household_fk
  foreign key (one_off_bill_id, household_id)
  references public.fin_one_off_bills (id, household_id) on delete set null (one_off_bill_id);
alter table public.fin_documents add constraint fin_documents_single_bill_kind
  check (bill_id is null or one_off_bill_id is null);
create index fin_documents_one_off_bill_idx on public.fin_documents (one_off_bill_id, household_id);

-- 3) Recusas do cruzamento avulsa x lançamento --------------------------------
create table public.fin_one_off_baixa_dismissals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  one_off_bill_id uuid not null,
  transaction_id uuid not null,
  reason text not null check (reason in ('nao_e','desfeita')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fin_one_off_baixa_dismissals_household_bill_tx_key unique (household_id, one_off_bill_id, transaction_id),
  constraint fin_one_off_baixa_dismissals_bill_household_fk foreign key (one_off_bill_id, household_id)
    references public.fin_one_off_bills (id, household_id) on delete cascade,
  constraint fin_one_off_baixa_dismissals_transaction_household_fk foreign key (transaction_id, household_id)
    references public.fin_transactions (id, household_id) on delete cascade
);
-- household_id já é coberto pelo unique (household_id, ...).
create index fin_one_off_baixa_dismissals_bill_idx on public.fin_one_off_baixa_dismissals (one_off_bill_id, household_id);
create index fin_one_off_baixa_dismissals_transaction_idx on public.fin_one_off_baixa_dismissals (transaction_id, household_id);
create index fin_one_off_baixa_dismissals_created_by_idx on public.fin_one_off_baixa_dismissals (created_by);

alter table public.fin_one_off_baixa_dismissals enable row level security;

create policy "fin_one_off_baixa_dismissals: membros leem" on public.fin_one_off_baixa_dismissals for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "fin_one_off_baixa_dismissals: membros criam" on public.fin_one_off_baixa_dismissals for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "fin_one_off_baixa_dismissals: membros editam" on public.fin_one_off_baixa_dismissals for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "fin_one_off_baixa_dismissals: membros apagam" on public.fin_one_off_baixa_dismissals for delete to authenticated
  using ((select public.is_household_member(household_id)));

revoke all on public.fin_one_off_baixa_dismissals from anon;
revoke truncate, references, trigger on public.fin_one_off_baixa_dismissals from authenticated;
