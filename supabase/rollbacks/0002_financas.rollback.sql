-- Rollback de 0002_financas. ATENÇÃO: apaga contas, lançamentos, categorias e regras.
drop view if exists public.fin_account_balances;
drop table if exists public.fin_rules;
drop table if exists public.fin_transactions;
drop table if exists public.fin_categories;
drop table if exists public.fin_accounts;
drop function if exists public.seed_fin_defaults(uuid);
alter table public.members drop constraint if exists members_id_household_key;

-- Restaura create_household da 0001 (sem seed de finanças).
create or replace function public.create_household(p_name text, p_member_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hid uuid;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  if exists (select 1 from public.household_users where user_id = v_uid) then
    raise exception 'usuário já pertence a uma família';
  end if;

  insert into public.households (name, created_by) values (trim(p_name), v_uid)
  returning id into v_hid;
  insert into public.household_users (household_id, user_id, role) values (v_hid, v_uid, 'owner');
  insert into public.members (household_id, user_id, name, relation)
  values (v_hid, v_uid, trim(p_member_name), 'titular');
  return v_hid;
end;
$$;
