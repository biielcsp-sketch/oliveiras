-- Rollback de 0022. Apaga o contador de leituras de arquivo da Oli (a contagem
-- do dia some; o limite diário recomeça do zero). Não há outros objetos.
drop table if exists public.oli_file_reads;
