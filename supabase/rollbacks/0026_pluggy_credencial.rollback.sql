-- Rollback de 0026. Remove a coluna credential de fin_pluggy_items.
-- ATENÇÃO: itens da Karen perdem a marca e passam a ser lidos com a credencial
-- principal, falhando com 404 até serem removidos (e reconectados, se o código antigo voltar).
alter table public.fin_pluggy_items drop column if exists credential;
