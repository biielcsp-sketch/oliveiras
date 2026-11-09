-- Rollback de 0010. Apaga carteirinhas, consultas e exames (dados de saúde somem;
-- faça backup antes) e as políticas/função do storage.
-- O bucket `saude` e seus arquivos NÃO são apagados por SQL (o Supabase bloqueia
-- delete direto em storage.*): depois do rollback, esvazie e apague o bucket
-- pela API de Storage ou pelo painel. Sem as políticas, nenhum usuário acessa o bucket.
drop policy if exists "saude: membros leem arquivos" on storage.objects;
drop policy if exists "saude: membros enviam arquivos" on storage.objects;
drop policy if exists "saude: membros atualizam arquivos" on storage.objects;
drop policy if exists "saude: membros apagam arquivos" on storage.objects;
drop function if exists public.saude_path_household(text);
drop table if exists public.health_exams;
drop table if exists public.health_appointments;
drop table if exists public.health_insurance_cards;
drop function if exists public.saude_touch();
