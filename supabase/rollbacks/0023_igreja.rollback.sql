-- Rollback de 0023. Apaga as tabelas do módulo Igreja (anotações/promessas, orações,
-- propósitos, aulas do Carisma e metadados de arquivos) e o cache de pastas do Drive
-- (google_drive_folders) e o log de resumos (igreja_summary_log; o limite diário recomeça
-- do zero): os dados somem; faça backup antes. Políticas, triggers,
-- índices e FKs caem com as tabelas.
--
-- Google Drive: os arquivos e pastas enviados ficam no Drive de cada pessoa. O SQL
-- não apaga nada no Drive; sem os metadados o app perde a referência a eles
-- (continuam acessíveis pelo próprio Google Drive do dono).
-- Nenhum bucket do Supabase Storage é criado por 0023, então não há o que remover lá.

-- Ordem: filhos antes dos pais (sem cascade, para não derrubar nada inesperado).
drop table if exists public.igreja_summary_log;
drop table if exists public.igreja_carisma_files;
drop table if exists public.google_drive_folders;
drop table if exists public.igreja_carisma_lessons;
drop table if exists public.igreja_purposes;
drop table if exists public.igreja_prayers;
drop table if exists public.igreja_words;
drop function if exists public.igreja_touch();
