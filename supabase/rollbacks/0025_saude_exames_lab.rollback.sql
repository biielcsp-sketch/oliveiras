-- Rollback de 0025. Apaga relatórios e resultados de exames de laboratório
-- (dados de saúde somem; faça backup antes). Os PDFs no bucket `saude` NÃO são
-- apagados por SQL: remova pela API de Storage se necessário (prefixo {household_id}/exams/).
drop table if exists public.health_lab_results;
drop table if exists public.health_lab_reports;
