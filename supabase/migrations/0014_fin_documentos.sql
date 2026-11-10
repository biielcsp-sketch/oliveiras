-- Finanças: leitura de PDF/JPEG (boletos e comprovantes). O arquivo vai para o
-- bucket privado `financas`; a extração da IA fica em `extracted` e o usuário
-- confirma (status), podendo ligar o documento a uma conta a pagar (fin_bills)
-- e/ou a um lançamento (fin_transactions). Mesmo padrão de 0003 (FKs compostas
-- (x, household_id)) e 0010 (bucket privado + função de caminho).
-- Rollback: rollbacks/0014_fin_documentos.rollback.sql

-- 1) Documentos ---------------------------------------------------------------
create table public.fin_documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null default 'outro' check (kind in ('boleto','comprovante','outro')),
  status text not null default 'pendente' check (status in ('pendente','confirmado','descartado')),
  file_path text not null check (char_length(file_path) <= 300),
  file_mime text not null check (file_mime in ('application/pdf','image/jpeg')),
  file_size int not null check (file_size between 1 and 5242880),
  extracted jsonb not null default '{}'::jsonb,
  payee text check (char_length(payee) <= 120),
  amount numeric(14,2) check (amount > 0 and amount <= 10000000),
  due_date date,
  paid_on date,
  barcode text check (barcode ~ '^[0-9]{44,48}$'),
  bill_id uuid,
  transaction_id uuid,
  bill_month text check (bill_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_documents_id_household_key unique (id, household_id),
  constraint fin_documents_extracted_object check (jsonb_typeof(extracted) = 'object'),
  constraint fin_documents_extracted_size check (pg_column_size(extracted) <= 16384),
  -- conta a pagar ligada exige o mês de referência
  constraint fin_documents_bill_month_required check (bill_id is null or bill_month is not null),
  constraint fin_documents_bill_household_fk foreign key (bill_id, household_id)
    references public.fin_bills (id, household_id) on delete set null (bill_id),
  constraint fin_documents_transaction_household_fk foreign key (transaction_id, household_id)
    references public.fin_transactions (id, household_id) on delete set null (transaction_id)
);
-- Lista da família e contagem diária (limite anti-abuso de custo da IA, feita pelo front via RLS).
create index fin_documents_household_created_idx on public.fin_documents (household_id, created_at desc);
create index fin_documents_bill_idx on public.fin_documents (bill_id, household_id);
create index fin_documents_transaction_idx on public.fin_documents (transaction_id, household_id);
create index fin_documents_household_month_idx on public.fin_documents (household_id, bill_month);
-- Anti-duplicidade garantida no banco (confirmações simultâneas no app não duplicam):
-- uma conta+mês só tem um documento confirmado; um boleto (código de barras) só
-- existe uma vez por família enquanto não for descartado. Comprovantes não entram.
create unique index fin_documents_bill_month_confirmed_uq on public.fin_documents (household_id, bill_id, bill_month)
  where status = 'confirmado' and bill_id is not null;
create unique index fin_documents_boleto_barcode_uq on public.fin_documents (household_id, barcode)
  where status <> 'descartado' and barcode is not null and kind = 'boleto';
-- FK para auth.users (advisor de performance aponta FK sem índice; mesmo padrão de 0003).
create index fin_documents_created_by_idx on public.fin_documents (created_by);

-- 2) RLS por família ----------------------------------------------------------
alter table public.fin_documents enable row level security;

create policy "fin_documents: membros leem" on public.fin_documents for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "fin_documents: membros criam" on public.fin_documents for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "fin_documents: membros editam" on public.fin_documents for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "fin_documents: membros apagam" on public.fin_documents for delete to authenticated
  using ((select public.is_household_member(household_id)));

revoke all on public.fin_documents from anon;
revoke truncate, references, trigger on public.fin_documents from authenticated;

-- 3) updated_at por trigger (não há função touch genérica; mesmo padrão de saude_touch)
create or replace function public.fin_documents_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger fin_documents_touch before update on public.fin_documents
  for each row execute function public.fin_documents_touch();
revoke execute on function public.fin_documents_touch() from public, anon, authenticated;

-- 4) fin_transactions.source aceita 'documento' --------------------------------
-- A constraint original é o check inline de 0002 (nome gerado pelo Postgres:
-- fin_transactions_source_check). Sem "if exists" de propósito: se o nome não
-- bater, a migração falha em vez de deixar dois checks. O novo conjunto é
-- superconjunto do antigo, então a validação das linhas existentes sempre passa.
alter table public.fin_transactions drop constraint fin_transactions_source_check;
alter table public.fin_transactions add constraint fin_transactions_source_check
  check (source in ('manual', 'ofx', 'csv', 'openfinance', 'documento'));

-- 5) Storage: bucket privado `financas` ----------------------------------------
-- Caminho padrão: {household_id}/docs/{uuid}.{pdf|jpg}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('financas', 'financas', false, 5242880, array['application/pdf','image/jpeg'])
on conflict (id) do nothing;

-- Extrai o household_id do caminho; fora do padrão => null => negado.
-- A regex valida o formato antes do cast, então nunca estoura erro de cast.
create or replace function public.fin_doc_path_household(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/docs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$'
    then split_part(name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.fin_doc_path_household(text) from public, anon;
grant execute on function public.fin_doc_path_household(text) to authenticated;

create policy "financas: membros leem arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'financas' and (select public.is_household_member(public.fin_doc_path_household(name))));
create policy "financas: membros enviam arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'financas' and (select public.is_household_member(public.fin_doc_path_household(name))));
create policy "financas: membros atualizam arquivos" on storage.objects for update to authenticated
  using (bucket_id = 'financas' and (select public.is_household_member(public.fin_doc_path_household(name))))
  with check (bucket_id = 'financas' and (select public.is_household_member(public.fin_doc_path_household(name))));
create policy "financas: membros apagam arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'financas' and (select public.is_household_member(public.fin_doc_path_household(name))));
