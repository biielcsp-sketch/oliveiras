-- Rollback de 0012. Apaga assinaturas push e o log de envios (as pessoas terão de
-- reativar as notificações) e remove os horários de lembrete dos medicamentos
-- (reminder_times some; o resto do medicamento permanece).
alter table public.health_medications
  drop constraint if exists health_medications_reminder_times_check,
  drop column if exists reminder_times;
drop table if exists public.push_dispatch_log;
drop table if exists public.push_subscriptions;
