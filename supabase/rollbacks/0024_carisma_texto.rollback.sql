-- Rollback de 0024: volta o check de file_mime ao de 0023 (sem text/plain).
-- ATENÇÃO: se existir alguma linha com file_mime = 'text/plain' em igreja_carisma_files,
-- o ADD CONSTRAINT abaixo FALHA (e, por ser uma transação só, nada muda). Este script NÃO
-- apaga dados. Antes de rodar, confira e decida (remover a linha e o arquivo no Drive,
-- ou manter a migração 0024):
--   select id, display_name, drive_file_id from public.igreja_carisma_files
--   where file_mime = 'text/plain';
-- Se for remover: delete from public.igreja_carisma_files where file_mime = 'text/plain';
-- (os arquivos continuam no Google Drive do dono; só some a referência no app).

begin;
alter table public.igreja_carisma_files
  drop constraint if exists igreja_carisma_files_file_mime_check;
alter table public.igreja_carisma_files
  add constraint igreja_carisma_files_file_mime_check
  check (file_mime in ('application/pdf','image/jpeg','image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
commit;
