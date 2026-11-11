-- Rollback de 0015. Apaga lista de compras, despensa, tarefas, manutenções e
-- seus históricos (os dados somem; faça backup antes). Ordem: filhas antes das mães.
drop table if exists public.casa_maintenance_log;
drop table if exists public.casa_maintenance;
drop table if exists public.casa_chore_log;
drop table if exists public.casa_chores;
drop table if exists public.casa_shopping_items;
drop table if exists public.casa_pantry_items;
drop function if exists public.casa_chores_check();
drop function if exists public.casa_touch();
