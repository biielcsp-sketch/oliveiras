-- Histórico da Oli: teto de mensagens por pessoa sobe de 300 para 2000.
-- Com ~60 mensagens/dia, 300 cobriam só ~5 dias e a Oli "esquecia" a conversa.
-- content <= 4000 caracteres, então no máximo ~8 MB por pessoa.
-- Só a função do trigger muda (offset 2000); tabela, RLS, grants e trigger seguem
-- os de 0020. Sem índice novo: a busca do app (user_id + content ilike, ordenada
-- por created_at desc, limite 20) usa oli_messages_user_idx (user_id, created_at
-- desc) e filtra no máximo 2000 linhas da própria pessoa.
-- Rollback: rollbacks/0028_oli_conversa_teto_2000.rollback.sql

-- SECURITY INVOKER: roda como o usuário e a política de delete
-- (user_id = auth.uid()) já cobre as linhas apagadas.
create or replace function public.oli_messages_trim() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.oli_messages
  where id in (
    select id from public.oli_messages
    where user_id = new.user_id
    order by created_at desc, id desc
    offset 2000
  );
  return null;
end; $$;
revoke execute on function public.oli_messages_trim() from public, anon, authenticated;
