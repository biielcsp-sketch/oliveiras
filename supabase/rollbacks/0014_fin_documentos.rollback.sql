-- Rollback de 0014. Apaga fin_documents (registros dos documentos lidos e a
-- extração da IA somem; faça backup antes; os índices únicos e checks da tabela
-- caem junto) e as políticas/função do storage.
--
-- fin_transactions.source: o check volta ao original de 0002. Escolha: o
-- rollback FALHA de forma explícita se já existirem lançamentos com
-- source = 'documento' (nada é convertido nem apagado silenciosamente). Para
-- prosseguir, decida antes o destino dessas linhas, por exemplo:
--   update public.fin_transactions set source = 'manual' where source = 'documento';
-- e rode o rollback de novo.
--
-- O bucket `financas` e seus arquivos NÃO são apagados por SQL (o Supabase
-- bloqueia delete direto em storage.*): depois do rollback, esvazie e apague o
-- bucket pela API de Storage ou pelo painel. Sem as políticas, nenhum usuário
-- acessa o bucket.
do $$
begin
  if exists (select 1 from public.fin_transactions where source = 'documento') then
    raise exception 'rollback 0014 abortado: existem lançamentos com source = ''documento''; converta-os (ex.: para ''manual'') antes de restaurar o check original';
  end if;
end $$;

drop policy if exists "financas: membros leem arquivos" on storage.objects;
drop policy if exists "financas: membros enviam arquivos" on storage.objects;
drop policy if exists "financas: membros atualizam arquivos" on storage.objects;
drop policy if exists "financas: membros apagam arquivos" on storage.objects;
drop function if exists public.fin_doc_path_household(text);

drop table if exists public.fin_documents;
drop function if exists public.fin_documents_touch();

alter table public.fin_transactions drop constraint fin_transactions_source_check;
alter table public.fin_transactions add constraint fin_transactions_source_check
  check (source in ('manual', 'ofx', 'csv', 'openfinance'));
