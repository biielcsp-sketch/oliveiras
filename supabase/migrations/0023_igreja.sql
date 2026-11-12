-- Igreja: Anotações e Promessas, Orações, Propósitos e aulas do seminário Carisma.
-- DIFERENTE dos outros módulos: dados PESSOAIS. Cada pessoa só vê o que é dela;
-- se marcar `shared`, os membros da família podem LER (nunca editar/apagar/mudar shared).
-- Padrões: FKs compostas (x, household_id) (0015/0017/0018), políticas por dono com
-- owner_id = (select auth.uid()) (0012), touch por trigger, revokes de anon.
-- Arquivos das aulas ficam no Google Drive de cada pessoa (conta de public.google_accounts,
-- 0007, escopo drive.file); aqui só os metadados. Nada vai para o Supabase Storage.
-- Rollback: rollbacks/0023_igreja.rollback.sql

-- 1) Anotações e Promessas --------------------------------------------------------
create table public.igreja_words (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shared boolean not null default false,
  kind text not null check (kind in ('anotacao','promessa')),
  title text check (char_length(title) <= 120),
  body text not null check (char_length(body) between 1 and 5000),
  received_on date not null default current_date,
  reference text check (char_length(reference) <= 120),
  fulfilled_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint igreja_words_fulfilled_only_promessa check (fulfilled_on is null or kind = 'promessa'),
  constraint igreja_words_id_household_key unique (id, household_id)
);
create index igreja_words_owner_idx on public.igreja_words (owner_id, kind, received_on desc);
create index igreja_words_household_idx on public.igreja_words (household_id);

-- 2) Orações ------------------------------------------------------------------------
create table public.igreja_prayers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shared boolean not null default false,
  title text not null check (char_length(title) between 1 and 120),
  person text check (char_length(person) <= 120),
  details text check (char_length(details) <= 2000),
  status text not null default 'orando' check (status in ('orando','respondida')),
  answered_on date,
  answer_notes text check (char_length(answer_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint igreja_prayers_answer_only_respondida
    check (status = 'respondida' or (answered_on is null and answer_notes is null))
);
create index igreja_prayers_owner_idx on public.igreja_prayers (owner_id, status);
create index igreja_prayers_household_idx on public.igreja_prayers (household_id);

-- 3) Propósitos ---------------------------------------------------------------------
create table public.igreja_purposes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shared boolean not null default false,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  status text not null default 'planejado' check (status in ('planejado','em_andamento','concluido')),
  starts_on date,
  ends_on date,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint igreja_purposes_ends_after_starts
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index igreja_purposes_owner_idx on public.igreja_purposes (owner_id, status);
create index igreja_purposes_household_idx on public.igreja_purposes (household_id);

-- 4) Aulas do seminário Carisma -----------------------------------------------------
create table public.igreja_carisma_lessons (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shared boolean not null default false,
  title text not null check (char_length(title) between 1 and 160),
  lesson_date date,
  subject text check (char_length(subject) <= 120),
  teacher text check (char_length(teacher) <= 120),
  notes text check (char_length(notes) <= 10000),
  summary text check (char_length(summary) <= 20000),
  summary_status text not null default 'nenhum' check (summary_status in ('nenhum','pronto','erro')),
  summarized_at timestamptz,
  drive_folder_id text check (char_length(drive_folder_id) between 1 and 200
    and drive_folder_id ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint igreja_carisma_lessons_id_household_key unique (id, household_id)
);
create index igreja_carisma_lessons_owner_idx on public.igreja_carisma_lessons (owner_id, lesson_date desc);
create index igreja_carisma_lessons_household_idx on public.igreja_carisma_lessons (household_id);

-- 5) Arquivos das aulas (no Google Drive do dono) ------------------------------------
-- Sem `shared`: a visibilidade vem da aula. status 'pendente' = sessão de envio ao
-- Drive criada e ainda não confirmada; 'pronto' = upload confirmado.
create table public.igreja_carisma_files (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lesson_id uuid not null,
  google_account_id uuid not null,
  drive_file_id text not null check (char_length(drive_file_id) between 1 and 200
    and drive_file_id ~ '^[A-Za-z0-9_-]+$'),
  web_view_link text check (char_length(web_view_link) <= 500
    and web_view_link ~ '^https://(drive|docs)\.google\.com/'),
  file_mime text not null check (file_mime in ('application/pdf','image/jpeg','image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  file_size int not null check (file_size between 1 and 20971520),
  display_name text not null check (char_length(display_name) between 1 and 120),
  status text not null default 'pendente' check (status in ('pendente','pronto')),
  created_at timestamptz not null default now(),
  constraint igreja_carisma_files_lesson_household_fk foreign key (lesson_id, household_id)
    references public.igreja_carisma_lessons (id, household_id) on delete cascade,
  constraint igreja_carisma_files_account_household_fk foreign key (google_account_id, household_id)
    references public.google_accounts (id, household_id) on delete cascade,
  constraint igreja_carisma_files_account_drive_key unique (google_account_id, drive_file_id)
);
create index igreja_carisma_files_lesson_idx on public.igreja_carisma_files (lesson_id, household_id);
create index igreja_carisma_files_account_idx on public.igreja_carisma_files (google_account_id, household_id);
create index igreja_carisma_files_household_idx on public.igreja_carisma_files (household_id);
create index igreja_carisma_files_owner_idx on public.igreja_carisma_files (owner_id);

-- 6) Cache de pastas do app no Google Drive (genérico; outros módulos podem reutilizar) --
create table public.google_drive_folders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  google_account_id uuid not null,
  key text not null check (char_length(key) between 1 and 120),
  folder_id text not null check (char_length(folder_id) between 1 and 200
    and folder_id ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  constraint google_drive_folders_account_household_fk foreign key (google_account_id, household_id)
    references public.google_accounts (id, household_id) on delete cascade,
  constraint google_drive_folders_account_key_key unique (google_account_id, key)
);
create index google_drive_folders_account_idx on public.google_drive_folders (google_account_id, household_id);
create index google_drive_folders_household_idx on public.google_drive_folders (household_id);

-- 6b) Log imutável de resumos do Carisma (limite diário por família) --------------------
-- Mesmo modelo de 0022 (oli_file_reads): o servidor registra 1 linha ANTES de chamar a IA
-- e conta as do dia por família. Não depende de summarized_at das aulas (o dono podia
-- zerar/recriar a aula e as aulas privadas do cônjuge ficavam fora da contagem).
-- Imutável: sem UPDATE/DELETE. authenticated só tem INSERT em (household_id, lesson_id);
-- id, created_by e created_at vêm dos defaults; informar outra coluna dá 42501.
-- lesson_id sem FK: a aula pode ser apagada e o registro precisa continuar contando.
create table public.igreja_summary_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  lesson_id uuid,
  created_at timestamptz not null default now()
);
create index igreja_summary_log_household_created_idx on public.igreja_summary_log (household_id, created_at desc);
create index igreja_summary_log_created_by_idx on public.igreja_summary_log (created_by);

-- 7) RLS ------------------------------------------------------------------------------
alter table public.igreja_words enable row level security;
alter table public.igreja_prayers enable row level security;
alter table public.igreja_purposes enable row level security;
alter table public.igreja_carisma_lessons enable row level security;
alter table public.igreja_carisma_files enable row level security;
alter table public.google_drive_folders enable row level security;
alter table public.igreja_summary_log enable row level security;

-- words/prayers/purposes/lessons: leitura do dono ou de item compartilhado da família;
-- escrita só do dono. with check no update impede trocar owner_id para outro usuário.
create policy "igreja_words: dono ou compartilhado lê" on public.igreja_words for select to authenticated
  using ((select public.is_household_member(household_id)) and (owner_id = (select auth.uid()) or shared));
create policy "igreja_words: dono cria" on public.igreja_words for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_words: dono edita" on public.igreja_words for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)))
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_words: dono apaga" on public.igreja_words for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));

create policy "igreja_prayers: dono ou compartilhado lê" on public.igreja_prayers for select to authenticated
  using ((select public.is_household_member(household_id)) and (owner_id = (select auth.uid()) or shared));
create policy "igreja_prayers: dono cria" on public.igreja_prayers for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_prayers: dono edita" on public.igreja_prayers for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)))
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_prayers: dono apaga" on public.igreja_prayers for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));

create policy "igreja_purposes: dono ou compartilhado lê" on public.igreja_purposes for select to authenticated
  using ((select public.is_household_member(household_id)) and (owner_id = (select auth.uid()) or shared));
create policy "igreja_purposes: dono cria" on public.igreja_purposes for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_purposes: dono edita" on public.igreja_purposes for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)))
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_purposes: dono apaga" on public.igreja_purposes for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));

create policy "igreja_carisma_lessons: dono ou compartilhado lê" on public.igreja_carisma_lessons for select to authenticated
  using ((select public.is_household_member(household_id)) and (owner_id = (select auth.uid()) or shared));
create policy "igreja_carisma_lessons: dono cria" on public.igreja_carisma_lessons for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_carisma_lessons: dono edita" on public.igreja_carisma_lessons for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)))
  with check (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));
create policy "igreja_carisma_lessons: dono apaga" on public.igreja_carisma_lessons for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_household_member(household_id)));

-- files: leitura pela visibilidade da aula (a subconsulta também passa pela RLS das aulas).
-- Escrita: dono do arquivo = usuário, aula do próprio usuário e conta Google do próprio usuário.
create policy "igreja_carisma_files: visível pela aula" on public.igreja_carisma_files for select to authenticated
  using (
    (select public.is_household_member(household_id))
    and exists (select 1 from public.igreja_carisma_lessons l
                where l.id = igreja_carisma_files.lesson_id
                  and l.household_id = igreja_carisma_files.household_id
                  and (l.owner_id = (select auth.uid()) or l.shared))
  );
create policy "igreja_carisma_files: dono da aula cria" on public.igreja_carisma_files for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select public.is_household_member(household_id))
    and exists (select 1 from public.igreja_carisma_lessons l
                where l.id = igreja_carisma_files.lesson_id
                  and l.household_id = igreja_carisma_files.household_id
                  and l.owner_id = (select auth.uid()))
    and exists (select 1 from public.google_accounts g
                join public.members m on m.id = g.member_id and m.household_id = g.household_id
                where g.id = igreja_carisma_files.google_account_id
                  and g.household_id = igreja_carisma_files.household_id
                  and m.user_id = (select auth.uid()))
  );
create policy "igreja_carisma_files: dono da aula edita" on public.igreja_carisma_files for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select public.is_household_member(household_id))
    and exists (select 1 from public.igreja_carisma_lessons l
                where l.id = igreja_carisma_files.lesson_id
                  and l.household_id = igreja_carisma_files.household_id
                  and l.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and (select public.is_household_member(household_id))
    and exists (select 1 from public.igreja_carisma_lessons l
                where l.id = igreja_carisma_files.lesson_id
                  and l.household_id = igreja_carisma_files.household_id
                  and l.owner_id = (select auth.uid()))
    and exists (select 1 from public.google_accounts g
                join public.members m on m.id = g.member_id and m.household_id = g.household_id
                where g.id = igreja_carisma_files.google_account_id
                  and g.household_id = igreja_carisma_files.household_id
                  and m.user_id = (select auth.uid()))
  );
create policy "igreja_carisma_files: dono da aula apaga" on public.igreja_carisma_files for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and (select public.is_household_member(household_id))
    and exists (select 1 from public.igreja_carisma_lessons l
                where l.id = igreja_carisma_files.lesson_id
                  and l.household_id = igreja_carisma_files.household_id
                  and l.owner_id = (select auth.uid()))
  );

-- google_drive_folders: família lê; escrita só com conta Google do próprio usuário.
create policy "google_drive_folders: membros leem" on public.google_drive_folders for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "google_drive_folders: dono da conta cria" on public.google_drive_folders for insert to authenticated
  with check (
    (select public.is_household_member(household_id))
    and exists (select 1 from public.google_accounts g
                join public.members m on m.id = g.member_id and m.household_id = g.household_id
                where g.id = google_drive_folders.google_account_id
                  and g.household_id = google_drive_folders.household_id
                  and m.user_id = (select auth.uid()))
  );
create policy "google_drive_folders: dono da conta edita" on public.google_drive_folders for update to authenticated
  using (
    (select public.is_household_member(household_id))
    and exists (select 1 from public.google_accounts g
                join public.members m on m.id = g.member_id and m.household_id = g.household_id
                where g.id = google_drive_folders.google_account_id
                  and g.household_id = google_drive_folders.household_id
                  and m.user_id = (select auth.uid()))
  )
  with check (
    (select public.is_household_member(household_id))
    and exists (select 1 from public.google_accounts g
                join public.members m on m.id = g.member_id and m.household_id = g.household_id
                where g.id = google_drive_folders.google_account_id
                  and g.household_id = google_drive_folders.household_id
                  and m.user_id = (select auth.uid()))
  );
create policy "google_drive_folders: dono da conta apaga" on public.google_drive_folders for delete to authenticated
  using (
    (select public.is_household_member(household_id))
    and exists (select 1 from public.google_accounts g
                join public.members m on m.id = g.member_id and m.household_id = g.household_id
                where g.id = google_drive_folders.google_account_id
                  and g.household_id = google_drive_folders.household_id
                  and m.user_id = (select auth.uid()))
  );

-- igreja_summary_log: família lê (contagem por família); membro registra em nome próprio.
-- Sem políticas de update/delete.
create policy "igreja_summary_log: membros leem" on public.igreja_summary_log for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "igreja_summary_log: membro registra" on public.igreja_summary_log for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.is_household_member(household_id)));

-- 8) updated_at -------------------------------------------------------------------------
-- igreja_carisma_files e google_drive_folders não têm updated_at (só created_at).
create or replace function public.igreja_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
revoke execute on function public.igreja_touch() from public, anon, authenticated;

create trigger igreja_words_touch before update on public.igreja_words
  for each row execute function public.igreja_touch();
create trigger igreja_prayers_touch before update on public.igreja_prayers
  for each row execute function public.igreja_touch();
create trigger igreja_purposes_touch before update on public.igreja_purposes
  for each row execute function public.igreja_touch();
create trigger igreja_carisma_lessons_touch before update on public.igreja_carisma_lessons
  for each row execute function public.igreja_touch();

-- 9) Grants ------------------------------------------------------------------------------
revoke all on public.igreja_words, public.igreja_prayers, public.igreja_purposes,
  public.igreja_carisma_lessons, public.igreja_carisma_files, public.google_drive_folders from anon;
revoke truncate, references, trigger on public.igreja_words, public.igreja_prayers, public.igreja_purposes,
  public.igreja_carisma_lessons, public.igreja_carisma_files, public.google_drive_folders from authenticated;

-- igreja_summary_log: revoga tudo (default privileges do Supabase dão ALL) e concede só
-- select e insert por coluna. INSERT de tabela inteira anularia o grant por coluna.
revoke all on public.igreja_summary_log from public, anon, authenticated;
grant select on public.igreja_summary_log to authenticated;
grant insert (household_id, lesson_id) on public.igreja_summary_log to authenticated;
