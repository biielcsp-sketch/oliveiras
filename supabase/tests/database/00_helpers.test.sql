-- Verifica que toda tabela do schema public tem RLS ligado.
-- Regra do projeto: tabela nova sem RLS reprova o CI.
begin;
select plan(1);

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'todas as tabelas de public têm RLS ligado'
);

select * from finish();
rollback;
