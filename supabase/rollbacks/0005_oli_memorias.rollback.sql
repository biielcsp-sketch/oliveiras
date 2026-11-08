-- Rollback de 0005. Apaga a tabela de memórias da Oli (e todas as memórias) e suas funções.
-- Se 0006 estiver aplicada, rode antes 0006_oli_memorias_ajustes.rollback.sql (opcional: o drop da tabela já leva a FK e os grants).
drop function if exists public.oli_search_memories(uuid, text, int);
drop table if exists public.oli_memories;
drop function if exists public.oli_memories_touch();
