-- Rollback de 0011. Apaga procedimentos, medicamentos e vacinas (dados de saúde
-- somem; faça backup antes) e restaura a regex de caminho da 0010 (só cards|exams).
-- ATENÇÃO: o Supabase bloqueia delete direto em storage.objects/buckets por SQL.
-- Objetos já enviados em `procedures/` e `vaccines/` do bucket `saude` ficam ÓRFÃOS
-- (inacessíveis, pois a função passa a negar esses caminhos) e devem ser removidos
-- pela API de Storage ou pelo painel.
drop table if exists public.health_vaccines;
drop table if exists public.health_medications;
drop table if exists public.health_procedures;

create or replace function public.saude_path_household(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(cards|exams)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.saude_path_household(text) from public, anon;
grant execute on function public.saude_path_household(text) to authenticated;
