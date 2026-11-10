-- Agendador dos avisos push: a cada minuto o pg_cron chama, via pg_net, o Edge
-- Function `push-dispatch`. URL e segredo vêm do Supabase Vault (nomes
-- `push_dispatch_url` e `push_dispatch_secret`, criados MANUALMENTE em produção;
-- nunca no repo). Sem as extensões (ex.: ambiente local/CI) a migração apenas avisa.
-- Rollback: rollbacks/0013_push_cron.rollback.sql

-- 1) Extensões (só se disponíveis) -------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create schema if not exists extensions;
    create extension if not exists pg_net with schema extensions;
  else
    raise warning 'pg_net indisponível: push_dispatch_tick não enviará chamadas';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  else
    raise warning 'pg_cron indisponível: job push-dispatch não será agendado';
  end if;
end $$;

-- 2) Função chamada pelo cron --------------------------------------------------
-- Sem segredo/URL/extensão: retorna sem erro e sem fazer nada. Nunca loga o segredo.
create or replace function public.push_dispatch_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  -- Chamada por humanos (JWT) é negada; o cron roda sem claims.
  if auth.uid() is not null then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;
revoke execute on function public.push_dispatch_tick() from public, anon, authenticated;

-- 3) Agendamento idempotente ----------------------------------------------------
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'push-dispatch') then
      perform cron.unschedule('push-dispatch');
    end if;
    perform cron.schedule('push-dispatch', '* * * * *', 'select public.push_dispatch_tick()');
  else
    raise warning 'schema cron ausente: job push-dispatch não agendado';
  end if;
end $$;
