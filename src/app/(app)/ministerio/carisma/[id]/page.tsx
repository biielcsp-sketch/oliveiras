import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { todaySP } from "@/lib/financas/today";
import { carismaAllowedFor } from "@/lib/family-access";
import { isUuid, sharedByLabel } from "@/lib/igreja/input";
import { summaryConfigured } from "@/lib/igreja/summarize";
import { carismaEnabled, cleanupStalePending, familyReaders, FILE_COLS, LESSON_COLS, memberAccounts, myDrive, type FileRow, type LessonRow } from "@/lib/igreja/carisma";
import { DriveBanner, googleNotice } from "../../_components/drive-banner";
import { LessonView } from "../../_components/lesson-view";

export const metadata = { title: "Aula · Carisma" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ google?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await getAppContext();
  const db = await createClient();
  // RLS: só a aula do usuário ou a que o cônjuge compartilhou.
  const { data } = await db.from("igreja_carisma_lessons").select(LESSON_COLS).eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  const lesson = data as LessonRow | null;
  if (!lesson) notFound();
  const mine = lesson.owner_id === ctx.user.id;
  if (!mine && !lesson.shared) notFound();

  const { data: fileRows } = await db.from("igreja_carisma_files").select(FILE_COLS).eq("household_id", ctx.household.id).eq("lesson_id", id).order("created_at").limit(100);
  let files = (fileRows ?? []) as FileRow[];
  const enabled = carismaEnabled(ctx.household.id);
  let drive = null;
  let withoutGoogle: string[] = [];
  let viewerHasGoogle = true;
  if (mine) {
    // Envios preparados há mais de 1 h e nunca confirmados: lixeira no Drive e linha apagada.
    const removed = await cleanupStalePending(db, ctx, files);
    if (removed.length) files = files.filter((f) => !removed.includes(f.id));
    if (enabled) drive = (await myDrive(db, ctx)).access;
    if (lesson.shared) withoutGoogle = (await familyReaders(db, ctx)).withoutGoogle;
  } else if (ctx.me) {
    viewerHasGoogle = (await memberAccounts(db, ctx.household.id, ctx.me.id)).some((a) => a.status !== "revogado");
  }
  const { google } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      {mine && drive && <DriveBanner access={drive} notice={googleNotice(google)} />}
      <LessonView
        lesson={{
          id: lesson.id,
          title: lesson.title,
          lesson_date: lesson.lesson_date,
          subject: lesson.subject,
          teacher: lesson.teacher,
          notes: lesson.notes,
          summary: lesson.summary,
          summary_status: lesson.summary_status,
          summarized_at: lesson.summarized_at,
          shared: lesson.shared,
          hasFolder: Boolean(lesson.drive_folder_id),
        }}
        files={files
          .filter((f) => mine || f.status === "pronto")
          .map((f) => ({ id: f.id, name: f.display_name, mime: f.file_mime, size: f.file_size, status: f.status, link: f.web_view_link }))}
        mine={mine}
        sharedBy={sharedByLabel(lesson, ctx.user.id, ctx.members)}
        canUpload={mine && drive === "ok"}
        canSummarize={mine && carismaAllowedFor(ctx.household.id) && summaryConfigured()}
        withoutGoogle={withoutGoogle}
        viewerHasGoogle={viewerHasGoogle}
        today={todaySP()}
      />
    </div>
  );
}
