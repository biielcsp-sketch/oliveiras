-- Histórico de conversa da Oli (assistente de IA da família).
-- A conversa é PRIVADA de cada pessoa: mesmo dentro da mesma família, ninguém
-- lê, cria ou apaga mensagens de outra pessoa. Mensagem não é editada (sem UPDATE).
-- Teto: 300 mensagens por pessoa; as mais antigas são apagadas por trigger.
-- Rollback: rollbacks/0020_oli_conversa.rollback.sql

create table public.oli_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','model')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index oli_messages_user_idx on public.oli_messages (user_id, created_at desc);
create index oli_messages_household_idx on public.oli_messages (household_id);

alter table public.oli_messages enable row level security;
create policy "pessoa le suas mensagens da oli" on public.oli_messages for select to authenticated
  using ((select public.is_household_member(household_id)) and user_id = (select auth.uid()));
create policy "pessoa cria suas mensagens da oli" on public.oli_messages for insert to authenticated
  with check ((select public.is_household_member(household_id)) and user_id = (select auth.uid()));
create policy "pessoa apaga suas mensagens da oli" on public.oli_messages for delete to authenticated
  using ((select public.is_household_member(household_id)) and user_id = (select auth.uid()));

revoke all on public.oli_messages from public, anon, authenticated;
grant select, insert, delete on public.oli_messages to authenticated;

-- Teto de 300 mensagens por pessoa. SECURITY INVOKER: roda como o usuário e a
-- política de delete (user_id = auth.uid()) já cobre as linhas apagadas.
create or replace function public.oli_messages_trim() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.oli_messages
  where id in (
    select id from public.oli_messages
    where user_id = new.user_id
    order by created_at desc, id desc
    offset 300
  );
  return null;
end; $$;
revoke execute on function public.oli_messages_trim() from public, anon, authenticated;

create trigger oli_messages_trim after insert on public.oli_messages
  for each row execute function public.oli_messages_trim();
