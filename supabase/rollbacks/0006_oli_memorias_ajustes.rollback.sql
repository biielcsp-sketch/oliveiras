-- Rollback de 0006. Volta ao estado de 0005 / produção 20261108042557:
-- FK simples oli_memories_member_fk e grants padrão do Supabase.
-- Observação: a FK simples volta a aceitar member_id de outra família.
drop index if exists public.oli_memories_member_idx;
alter table public.oli_memories drop constraint if exists oli_memories_member_household_fk;
alter table public.oli_memories drop constraint if exists oli_memories_member_fk;
alter table public.oli_memories
  add constraint oli_memories_member_fk foreign key (member_id) references public.members(id) on delete set null;

grant select, insert, update, delete, truncate, references, trigger on public.oli_memories to anon, authenticated;

grant execute on function public.oli_search_memories(uuid, text, int) to public, anon, authenticated;
grant execute on function public.oli_memories_touch() to public, anon, authenticated;
