import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { getAppContext } from "@/lib/data";
import { carismaAllowedFor } from "@/lib/family-access";
import { googleConfigured } from "@/lib/google/config";
import { RevokedError, withToken, type AccountWithToken } from "@/lib/google/agenda";
import {
  driveAccessOf,
  ensureFolder,
  grantReader,
  pickDriveAccount,
  revokeAllButOwner,
  trashFile,
  type DriveAccess,
  type FolderCache,
} from "@/lib/google/drive";
import { isStalePending, lessonFolderName } from "./files";

/**
 * Carisma no servidor: conta Google (Drive) do usuário, pastas do app, compartilhamento da pasta da aula
 * com o cônjuge e limpeza de envios não confirmados. Tudo com a SESSÃO do usuário (RLS), nunca chave de serviço.
 */
export type Db = Awaited<ReturnType<typeof createClient>>;
export type Ctx = Awaited<ReturnType<typeof getAppContext>>;
export type DriveAccount = AccountWithToken & { scopes: string | null };

const ACCOUNT_COLS = "id, household_id, member_id, google_sub, email, status, last_error, last_sync_at, scopes";

export const LESSON_COLS =
  "id, owner_id, shared, title, lesson_date, subject, teacher, notes, summary, summary_status, summarized_at, drive_folder_id, created_at";
export const FILE_COLS = "id, owner_id, lesson_id, google_account_id, drive_file_id, web_view_link, file_mime, file_size, display_name, status, created_at";

export type LessonRow = {
  id: string;
  owner_id: string;
  shared: boolean;
  title: string;
  lesson_date: string | null;
  subject: string | null;
  teacher: string | null;
  notes: string | null;
  summary: string | null;
  summary_status: "nenhum" | "pronto" | "erro";
  summarized_at: string | null;
  drive_folder_id: string | null;
  created_at: string;
};

export type FileRow = {
  id: string;
  owner_id: string;
  lesson_id: string;
  google_account_id: string;
  drive_file_id: string;
  web_view_link: string | null;
  file_mime: string;
  file_size: number;
  display_name: string;
  status: "pendente" | "pronto";
  created_at: string;
};

export const carismaEnabled = (householdId: string) => googleConfigured() && carismaAllowedFor(householdId);

/* ---------- Contas ---------- */

/** Contas Google (com token cifrado) de um membro. Só o servidor lê token_ciphertext. */
export async function memberAccounts(db: Db, householdId: string, memberId: string) {
  const { data } = await db
    .from("google_accounts")
    .select(`${ACCOUNT_COLS}, token_ciphertext`)
    .eq("household_id", householdId)
    .eq("member_id", memberId)
    .order("created_at");
  return (data ?? []) as DriveAccount[];
}

export async function myDrive(db: Db, ctx: Ctx): Promise<{ access: DriveAccess; account: DriveAccount | null }> {
  if (!ctx.me) return { access: "sem-conta", account: null };
  const accounts = await memberAccounts(db, ctx.household.id, ctx.me.id);
  return { access: driveAccessOf(accounts), account: pickDriveAccount(accounts) };
}

/** Conta específica do usuário (a de um arquivo). Nunca devolve conta de outra pessoa. */
export async function myAccountById(db: Db, ctx: Ctx, accountId: string) {
  if (!ctx.me) return null;
  const { data } = await db
    .from("google_accounts")
    .select(`${ACCOUNT_COLS}, token_ciphertext`)
    .eq("household_id", ctx.household.id)
    .eq("member_id", ctx.me.id)
    .eq("id", accountId)
    .maybeSingle();
  return (data as DriveAccount | null) ?? null;
}

export const runWithDrive = <T>(db: Db, acc: DriveAccount, fn: (token: string) => Promise<T>) => withToken(db, acc, fn);
export { RevokedError };

/** E-mails Google dos outros adultos da família (para ler a pasta compartilhada) e quem ainda não conectou. */
export async function familyReaders(db: Db, ctx: Ctx) {
  const others = ctx.members.filter((m) => m.user_id && m.id !== ctx.me?.id);
  if (!others.length) return { emails: [] as string[], withoutGoogle: [] as string[] };
  const { data } = await db
    .from("google_accounts")
    .select("member_id, email, status")
    .eq("household_id", ctx.household.id)
    .in(
      "member_id",
      others.map((m) => m.id),
    );
  const rows = (data ?? []) as { member_id: string; email: string; status: string }[];
  const active = rows.filter((r) => r.status !== "revogado");
  return {
    emails: [...new Set(active.map((r) => r.email.toLowerCase()))],
    withoutGoogle: others.filter((m) => !active.some((r) => r.member_id === m.id)).map((m) => m.name),
  };
}

/* ---------- Pastas ---------- */

/** Cache em google_drive_folders (google_account_id, key). */
export function accountFolderCache(db: Db, householdId: string, accountId: string, key: string): FolderCache {
  return {
    async get() {
      const { data } = await db
        .from("google_drive_folders")
        .select("folder_id")
        .eq("household_id", householdId)
        .eq("google_account_id", accountId)
        .eq("key", key)
        .maybeSingle();
      return (data?.folder_id as string | undefined) ?? null;
    },
    async set(folderId) {
      const { error } = await db
        .from("google_drive_folders")
        .upsert({ household_id: householdId, google_account_id: accountId, key, folder_id: folderId }, { onConflict: "google_account_id,key" });
      if (error) throw new Error("Falha ao guardar a pasta do Drive.");
    },
  };
}

/** Cache da pasta da aula na coluna drive_folder_id (só o dono atualiza; RLS). */
export function lessonFolderCache(db: Db, householdId: string, lesson: Pick<LessonRow, "id" | "drive_folder_id">): FolderCache {
  return {
    get: async () => lesson.drive_folder_id,
    async set(folderId) {
      const { error } = await db.from("igreja_carisma_lessons").update({ drive_folder_id: folderId }).eq("household_id", householdId).eq("id", lesson.id);
      if (error) throw new Error("Falha ao guardar a pasta da aula.");
      lesson.drive_folder_id = folderId;
    },
  };
}

/** "Oliveira's" → "Carisma" → pasta da aula. Pasta apagada no Drive é recriada. */
export async function ensureLessonFolder(db: Db, ctx: Ctx, acc: DriveAccount, token: string, lesson: LessonRow) {
  const hid = ctx.household.id;
  const root = await ensureFolder(token, accountFolderCache(db, hid, acc.id, "root"), "Oliveira's", null);
  const carisma = await ensureFolder(token, accountFolderCache(db, hid, acc.id, "carisma"), "Carisma", root.id);
  const folder = await ensureFolder(token, lessonFolderCache(db, hid, lesson), lessonFolderName(lesson.title, lesson.lesson_date), carisma.id);
  return folder.id;
}

/**
 * Compartilhar: leitura da pasta da aula para os e-mails Google atuais da família.
 * Descompartilhar: tira TODAS as permissões que não são do dono (vale mesmo se a conta do cônjuge mudou).
 */
export async function syncFolderSharing(token: string, folderId: string, emails: string[], shared: boolean) {
  if (!shared) {
    await revokeAllButOwner(token, folderId);
    return;
  }
  for (const email of emails) await grantReader(token, folderId, email);
}

/* ---------- Aula e arquivos do usuário ---------- */

export async function ownLesson(db: Db, ctx: Ctx, lessonId: string) {
  const { data } = await db
    .from("igreja_carisma_lessons")
    .select(LESSON_COLS)
    .eq("household_id", ctx.household.id)
    .eq("owner_id", ctx.user.id)
    .eq("id", lessonId)
    .maybeSingle();
  return (data as LessonRow | null) ?? null;
}

export async function ownFile(db: Db, ctx: Ctx, fileId: string) {
  const { data } = await db
    .from("igreja_carisma_files")
    .select(FILE_COLS)
    .eq("household_id", ctx.household.id)
    .eq("owner_id", ctx.user.id)
    .eq("id", fileId)
    .maybeSingle();
  return (data as FileRow | null) ?? null;
}

/** Manda o arquivo para a lixeira do Drive (conta do arquivo) e apaga a linha. Falha do Drive mantém a linha. */
export async function trashAndForget(db: Db, ctx: Ctx, file: FileRow) {
  const acc = await myAccountById(db, ctx, file.google_account_id);
  // Conta revogada: não dá para mexer no Drive; pede para reconectar em vez de esquecer o arquivo lá.
  if (acc?.status === "revogado") throw new RevokedError("revogado");
  if (acc) await runWithDrive(db, acc, (t) => trashFile(t, file.drive_file_id));
  const { error } = await db.from("igreja_carisma_files").delete().eq("household_id", ctx.household.id).eq("owner_id", ctx.user.id).eq("id", file.id);
  if (error) throw new Error("Falha ao apagar o arquivo.");
}

/** Envios pendentes há mais de 1 h (sessão criada e nunca confirmada): lixeira no Drive (se chegou) e linha apagada. */
export async function cleanupStalePending(db: Db, ctx: Ctx, files: FileRow[], now = Date.now()) {
  const stale = files.filter((f) => f.owner_id === ctx.user.id && isStalePending(f, now));
  const removed: string[] = [];
  for (const f of stale) {
    try {
      await trashAndForget(db, ctx, f);
      removed.push(f.id);
    } catch {
      // Fica para a próxima abertura; nada do arquivo vai para log.
    }
  }
  return removed;
}
