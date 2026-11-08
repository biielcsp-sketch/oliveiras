-- Ajustes de segurança em oli_memories (criada em 0005 / produção 20261108042557).
-- 1) member_id só pode apontar para pessoa da MESMA família (FK composta,
--    mesmo padrão de 0002–0004; members_id_household_key vem de 0002).
-- 2) anon perde todo acesso à tabela; authenticated fica só com
--    select/insert/update/delete (filtrados por RLS).
-- 3) Funções: busca só para authenticated; função de trigger sem execute direto.
-- Idempotente: pode rodar de novo sem erro. Rollback: rollbacks/0006_oli_memorias_ajustes.rollback.sql

alter table public.oli_memories drop constraint if exists oli_memories_member_fk;
alter table public.oli_memories drop constraint if exists oli_memories_member_household_fk;
alter table public.oli_memories
  add constraint oli_memories_member_household_fk foreign key (member_id, household_id)
    references public.members (id, household_id) on delete set null (member_id);
create index if not exists oli_memories_member_idx on public.oli_memories (member_id, household_id);

revoke all on public.oli_memories from anon;
revoke truncate, references, trigger on public.oli_memories from authenticated;

revoke execute on function public.oli_search_memories(uuid, text, int) from public, anon;
grant execute on function public.oli_search_memories(uuid, text, int) to authenticated;
revoke execute on function public.oli_memories_touch() from public, anon, authenticated;
