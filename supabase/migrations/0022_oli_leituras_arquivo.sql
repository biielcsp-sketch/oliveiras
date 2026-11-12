-- Oli: contador de leituras de arquivo (botão "+"). Cada leitura chama a IA
-- (Gemini, pago); o servidor registra 1 linha ANTES da chamada e conta as do dia
-- para aplicar o limite diário por família. Não guarda nada do documento.
-- Registro é imutável para o usuário: sem UPDATE/DELETE (apagar burlaria o limite).
-- created_at/created_by não são falsificáveis: authenticated só tem INSERT na
-- coluna household_id (grant por coluna); id, created_by e created_at vêm sempre
-- dos defaults (gen_random_uuid(), auth.uid(), now()). Informar qualquer outra
-- coluna no insert dá 42501. Escolhido em vez de trigger/check porque é mais
-- simples, falha de forma explícita e não depende de relógio (check com now()
-- não é estável e rejeitaria só parte das fraudes).
-- Rollback: rollbacks/0022_oli_leituras_arquivo.rollback.sql

create table public.oli_file_reads (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Contagem diária por família (household_id = X and created_at >= início do dia).
create index oli_file_reads_household_created_idx on public.oli_file_reads (household_id, created_at desc);
-- FK para auth.users (advisor aponta FK sem índice; mesmo padrão de 0014).
create index oli_file_reads_created_by_idx on public.oli_file_reads (created_by);

alter table public.oli_file_reads enable row level security;
create policy "oli_file_reads: membros leem" on public.oli_file_reads for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "oli_file_reads: membros registram" on public.oli_file_reads for insert to authenticated
  with check ((select public.is_household_member(household_id)));

-- Os default privileges do Supabase dão ALL a anon/authenticated em tabela nova:
-- revoga tudo e concede só o necessário. INSERT de tabela inteira anularia o
-- grant por coluna, por isso ele não é concedido.
revoke all on public.oli_file_reads from public, anon, authenticated;
grant select on public.oli_file_reads to authenticated;
grant insert (household_id) on public.oli_file_reads to authenticated;
