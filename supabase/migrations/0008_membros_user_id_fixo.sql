-- Trava o vínculo pessoa ↔ login em members.
-- Antes (0001): qualquer membro da família podia alterar user_id/household_id de
-- qualquer membro e criar membro com user_id de outra pessoa. Com isso um cônjuge
-- conseguia "virar" o outro e contornar regras de dono (ex.: google_accounts, 0007).
-- 1) UPDATE: authenticated só altera name, relation, birth_date e color.
-- 2) INSERT pelo app: só dependente (user_id null). Titular e cônjuge entram só
--    por create_household/join_household (security definer, não passam por RLS/grants).
-- Rollback: rollbacks/0008_membros_user_id_fixo.rollback.sql

revoke update on public.members from authenticated;
grant update (name, relation, birth_date, color) on public.members to authenticated;

drop policy "members: membros criam" on public.members;
create policy "members: membros criam dependentes" on public.members
  for insert to authenticated
  with check (public.is_household_member(household_id) and user_id is null);
