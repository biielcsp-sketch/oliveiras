-- Rollback de 0021. ATENÇÃO: apaga as contas avulsas, seus pagamentos e as
-- recusas do cruzamento avulsa x lançamento (os dados somem; faça backup antes).
-- Lançamentos (fin_transactions) e documentos (fin_documents) NÃO são apagados:
-- documentos ligados a avulsas apenas perdem o vínculo (coluna one_off_bill_id
-- removida). Ordem: filhas antes das mães.
drop table if exists public.fin_one_off_baixa_dismissals;

drop index if exists public.fin_documents_one_off_bill_idx;
alter table public.fin_documents drop constraint if exists fin_documents_single_bill_kind;
alter table public.fin_documents drop constraint if exists fin_documents_one_off_bill_household_fk;
alter table public.fin_documents drop column if exists one_off_bill_id;

drop table if exists public.fin_one_off_bills;
