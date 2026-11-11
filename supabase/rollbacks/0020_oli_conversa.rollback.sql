-- Rollback de 0020. Apaga o histórico de conversa da Oli (os dados somem).
drop trigger if exists oli_messages_trim on public.oli_messages;
drop function if exists public.oli_messages_trim();
drop table if exists public.oli_messages;
