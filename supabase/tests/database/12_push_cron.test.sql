-- Agendador push: função fechada para anon/authenticated e inofensiva sem segredos.
begin;
select plan(11);

select has_function('public', 'push_dispatch_tick', array[]::text[], 'push_dispatch_tick existe');
select ok(not has_function_privilege('anon', 'public.push_dispatch_tick()', 'execute'), 'anon sem execute');
select ok(not has_function_privilege('authenticated', 'public.push_dispatch_tick()', 'execute'), 'authenticated sem execute');
select ok((select prosecdef from pg_proc where oid = 'public.push_dispatch_tick()'::regprocedure), 'security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.push_dispatch_tick()'::regprocedure), 'search_path vazio');

-- Sem segredos no Vault: retorna sem erro
delete from vault.secrets where name in ('push_dispatch_url', 'push_dispatch_secret');
select lives_ok($$ select public.push_dispatch_tick() $$, 'sem segredos no Vault retorna sem erro');

-- Privilégio: anon e authenticated recebem 42501
set local role anon;
select throws_ok($$ select public.push_dispatch_tick() $$, '42501', null, 'anon chamando a função recebe 42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$ select public.push_dispatch_tick() $$, '42501', null, 'authenticated chamando a função recebe 42501');
reset role;

-- Defesa em profundidade: mesmo com EXECUTE, claim de usuário é negado pelo corpo
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$ select public.push_dispatch_tick() $$, '42501', 'acesso negado', 'claim de usuário (auth.uid) negado dentro da função');
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select public.push_dispatch_tick() $$, 'sem claim (cron) volta a funcionar');

-- Job agendado quando o pg_cron está presente; caso contrário, não se aplica
select ok(
  case when to_regnamespace('cron') is null then true
       else (select count(*) = 1 from cron.job where jobname = 'push-dispatch' and schedule = '* * * * *')
  end,
  'job push-dispatch agendado a cada minuto (ou pg_cron ausente)');

select * from finish();
rollback;
