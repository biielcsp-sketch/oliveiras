-- Rollback de 0013: desagenda o job e remove a função. NÃO remove as extensões
-- pg_cron/pg_net (podem ser usadas por outros recursos; `drop extension pg_net`
-- apagaria a fila e as respostas HTTP) nem os segredos do Vault
-- (remova `push_dispatch_url`/`push_dispatch_secret` manualmente se quiser).
do $$
begin
  if to_regnamespace('cron') is not null and exists (select 1 from cron.job where jobname = 'push-dispatch') then
    perform cron.unschedule('push-dispatch');
  end if;
end $$;
drop function if exists public.push_dispatch_tick();
