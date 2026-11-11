-- Rollback de 0018. Apaga as tabelas da aba Pet (pets, vacinas/remédios,
-- veterinário, cuidados e histórico, peso, ração): os dados somem; faça backup
-- antes. Políticas, triggers, índices e FKs caem com as tabelas.
-- public.casa_touch (0015) e casa_providers (0017) continuam.
--
-- Storage: a função de caminho volta à regex de 0017 (só {household_id}/docs/).
-- Arquivos já enviados em {household_id}/pets/ ficam ÓRFÃOS e INACESSÍVEIS
-- (as políticas do bucket `casa` passam a negar esse caminho). O SQL não apaga
-- objetos do Storage: remova a pasta pets/ pela API de Storage ou pelo painel
-- se quiser liberar espaço.

-- Ordem: filhos antes dos pais (sem cascade, para não derrubar nada inesperado).
drop table if exists public.casa_pet_care_log;
drop table if exists public.casa_pet_care;
drop table if exists public.casa_pet_food;
drop table if exists public.casa_pet_weights;
drop table if exists public.casa_pet_vet;
drop table if exists public.casa_pet_health;
drop table if exists public.casa_pets;

create or replace function public.casa_doc_path_household(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/docs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$'
    then split_part(name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.casa_doc_path_household(text) from public, anon;
grant execute on function public.casa_doc_path_household(text) to authenticated;
