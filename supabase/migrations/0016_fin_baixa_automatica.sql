-- Contas fixas: baixa automática pelo cruzamento com o extrato.
-- 1) fin_bill_payments.auto marca a baixa feita automaticamente (aditiva:
--    linhas existentes ficam false, que é o que elas são: baixas manuais).
-- 2) fin_baixa_dismissals guarda os pares conta x lançamento que o usuário
--    recusou ("não é") ou desfez, para o cruzamento não sugerir/baixar de novo.
-- Mesmo padrão de 0003/0014: RLS por família e FKs compostas (x, household_id).
-- Rollback: rollbacks/0016_fin_baixa_automatica.rollback.sql

alter table public.fin_bill_payments add column auto boolean not null default false;

create table public.fin_baixa_dismissals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bill_id uuid not null,
  transaction_id uuid not null,
  reason text not null check (reason in ('nao_e','desfeita')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fin_baixa_dismissals_household_bill_tx_key unique (household_id, bill_id, transaction_id),
  constraint fin_baixa_dismissals_bill_household_fk foreign key (bill_id, household_id)
    references public.fin_bills (id, household_id) on delete cascade,
  constraint fin_baixa_dismissals_transaction_household_fk foreign key (transaction_id, household_id)
    references public.fin_transactions (id, household_id) on delete cascade
);
-- household_id já é coberto pelo unique (household_id, ...).
create index fin_baixa_dismissals_bill_idx on public.fin_baixa_dismissals (bill_id, household_id);
create index fin_baixa_dismissals_transaction_idx on public.fin_baixa_dismissals (transaction_id, household_id);
create index fin_baixa_dismissals_created_by_idx on public.fin_baixa_dismissals (created_by);

alter table public.fin_baixa_dismissals enable row level security;

create policy "fin_baixa_dismissals: membros leem" on public.fin_baixa_dismissals for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "fin_baixa_dismissals: membros criam" on public.fin_baixa_dismissals for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "fin_baixa_dismissals: membros editam" on public.fin_baixa_dismissals for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "fin_baixa_dismissals: membros apagam" on public.fin_baixa_dismissals for delete to authenticated
  using ((select public.is_household_member(household_id)));

revoke all on public.fin_baixa_dismissals from anon;
revoke truncate, references, trigger on public.fin_baixa_dismissals from authenticated;
