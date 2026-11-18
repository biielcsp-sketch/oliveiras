-- Rollback de 0028. Teto do histórico da Oli volta a 300 mensagens por pessoa.
-- ATENÇÃO: a função volta ao offset 300, mas as linhas acima de 300 só são
-- apagadas na próxima mensagem de cada pessoa (o trigger roda no insert); nessa
-- hora a pessoa perde tudo além das 300 mais recentes.
create or replace function public.oli_messages_trim() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.oli_messages
  where id in (
    select id from public.oli_messages
    where user_id = new.user_id
    order by created_at desc, id desc
    offset 300
  );
  return null;
end; $$;
revoke execute on function public.oli_messages_trim() from public, anon, authenticated;
