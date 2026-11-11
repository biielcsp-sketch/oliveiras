-- Rollback de 0019. Remove as colunas da foto do pet (os dados dessas colunas
-- somem; faça backup antes). Só isso: bucket, função de caminho e políticas
-- ficam como estão. Arquivos já enviados em {household_id}/pets/*.jpg ficam
-- órfãos no Storage (o SQL não apaga objetos); remova pela API ou painel.
alter table public.casa_pets drop constraint if exists casa_pets_photo_path_household;
alter table public.casa_pets drop constraint if exists casa_pets_photo_all_or_none;
alter table public.casa_pets
  drop column if exists photo_path,
  drop column if exists photo_mime,
  drop column if exists photo_size;
