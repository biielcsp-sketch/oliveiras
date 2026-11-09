-- Rollback de 0008. Volta ao estado de 0001: authenticated altera todas as
-- colunas de members e cria membro com qualquer user_id (reabre o risco de um
-- membro assumir o login de outro).
drop policy if exists "members: membros criam dependentes" on public.members;
drop policy if exists "members: membros criam" on public.members;
create policy "members: membros criam" on public.members
  for insert to authenticated with check (public.is_household_member(household_id));

revoke update (name, relation, birth_date, color) on public.members from authenticated;
grant update on public.members to authenticated;
