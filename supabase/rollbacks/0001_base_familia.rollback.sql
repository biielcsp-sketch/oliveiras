-- Rollback de 0001_base_familia. ATENÇÃO: apaga famílias, vínculos e membros.
drop function if exists public.join_household(text, text);
drop function if exists public.create_household(text, text);
drop table if exists public.members;
drop table if exists public.household_users;
drop table if exists public.households;
drop function if exists public.is_household_member(uuid);
