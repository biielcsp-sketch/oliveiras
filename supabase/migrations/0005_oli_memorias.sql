-- Memórias da Oli (assistente de IA da família).
--
-- ATENÇÃO: em PRODUÇÃO esta migração JÁ FOI APLICADA fora do repositório,
-- como versão 20261108042557, nome "oli_memories". NÃO reaplique em produção.
-- Este arquivo existe só para recriar o histórico no Supabase local e no CI,
-- e repete fielmente o SQL aplicado lá. Os ajustes de segurança (FK composta
-- de member_id e grants) estão em 0006_oli_memorias_ajustes.sql.

create table public.oli_memories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid,
  category text not null default 'geral'
    check (category in ('geral','preferencia','pessoa','financas','casa','saude','ministerio','agenda')),
  content text not null check (char_length(content) between 3 and 500),
  source text not null default 'oli' check (source in ('oli','manual')),
  fts tsvector generated always as (to_tsvector('portuguese', content)) stored,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oli_memories_member_fk foreign key (member_id) references public.members(id) on delete set null
);
create index oli_memories_household_idx on public.oli_memories (household_id, created_at desc);
create index oli_memories_fts_idx on public.oli_memories using gin (fts);
alter table public.oli_memories enable row level security;
create policy "membros leem memorias" on public.oli_memories for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "membros criam memorias" on public.oli_memories for insert to authenticated
  with check ((select public.is_household_member(household_id)));
create policy "membros editam memorias" on public.oli_memories for update to authenticated
  using ((select public.is_household_member(household_id)))
  with check ((select public.is_household_member(household_id)));
create policy "membros apagam memorias" on public.oli_memories for delete to authenticated
  using ((select public.is_household_member(household_id)));
create or replace function public.oli_memories_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger oli_memories_touch before update on public.oli_memories
  for each row execute function public.oli_memories_touch();
create or replace function public.oli_search_memories(p_household uuid, p_query text, p_limit int default 8)
returns setof public.oli_memories
language sql stable security invoker set search_path = '' as $$
  select m.* from public.oli_memories m
  where m.household_id = p_household
    and (m.fts @@ websearch_to_tsquery('portuguese', p_query)
         or m.content ilike '%' || replace(replace(p_query, '%', ''), '_', '') || '%')
  order by ts_rank(m.fts, websearch_to_tsquery('portuguese', p_query)) desc, m.created_at desc
  limit least(greatest(p_limit, 1), 20);
$$;
