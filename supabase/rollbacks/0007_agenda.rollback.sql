-- Rollback de 0007. Apaga as tabelas da agenda (contas Google conectadas,
-- agendas e eventos espelhados) e as funções de trigger. Os eventos são cópia
-- do Google: reconectar a conta e sincronizar recria tudo, mas os tokens
-- criptografados se perdem (cada membro precisa reconectar a conta Google).
-- Os triggers caem junto com as tabelas; as funções são apagadas depois delas.
drop table if exists public.cal_events;
drop table if exists public.cal_calendars;
drop table if exists public.google_accounts;
drop function if exists public.google_accounts_guard();
drop function if exists public.agenda_touch();
