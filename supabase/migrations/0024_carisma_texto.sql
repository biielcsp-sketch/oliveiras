-- 0024: aceita arquivos de texto (.txt, text/plain) nos anexos das aulas do Carisma.
-- Só troca o check de file_mime em igreja_carisma_files (criado em 0023, nome padrão
-- igreja_carisma_files_file_mime_check). Mantém os demais tipos, o limite de 20 MB e as
-- outras regras. A lista nova é superconjunto da antiga: linhas existentes continuam válidas.
-- Idempotente: pode rodar de novo sem erro. RLS, políticas e índices não mudam.

alter table public.igreja_carisma_files
  drop constraint if exists igreja_carisma_files_file_mime_check;

alter table public.igreja_carisma_files
  add constraint igreja_carisma_files_file_mime_check
  check (file_mime in ('application/pdf','image/jpeg','image/png','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
