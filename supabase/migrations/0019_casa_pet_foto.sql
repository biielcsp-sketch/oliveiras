-- Casa: foto do pet. Aditiva (colunas nulas; linhas existentes não mudam).
-- Foto opcional e tudo-ou-nada, só JPEG (o front converte HEIC/PNG), até 5 MB.
-- Caminho no bucket privado `casa`: {household_id}/pets/{uuid}.jpg. O bucket
-- (0017) já aceita image/jpeg e 5 MB, e a função casa_doc_path_household (0018)
-- já aceita a pasta pets/: nenhuma política de storage muda.
-- O caminho precisa começar com o household_id do próprio registro: o banco
-- impede um pet de apontar para arquivo de outra família (check na própria linha;
-- household_id é imutável de fato, pois a política de update o prende à família).
-- RLS de casa_pets (0018) não muda. Rollback: rollbacks/0019_casa_pet_foto.rollback.sql

alter table public.casa_pets
  add column photo_path text check (char_length(photo_path) <= 300),
  add column photo_mime text check (photo_mime = 'image/jpeg'),
  add column photo_size int check (photo_size between 1 and 5242880),
  add constraint casa_pets_photo_all_or_none
    check ((photo_path is null) = (photo_mime is null) and (photo_mime is null) = (photo_size is null)),
  add constraint casa_pets_photo_path_household
    check (photo_path is null or photo_path ~ ('^' || household_id::text
      || '/pets/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'));
