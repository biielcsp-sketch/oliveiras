import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { todaySP } from "@/lib/financas/today";
import { withOwnership } from "@/lib/igreja/input";
import { carismaEnabled, LESSON_COLS, myDrive, type LessonRow } from "@/lib/igreja/carisma";
import { DriveBanner, googleNotice } from "../_components/drive-banner";
import { LessonsView } from "../_components/lessons-view";

export const metadata = { title: "Carisma · Igreja" };

export default async function Page({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db
    .from("igreja_carisma_lessons")
    .select(LESSON_COLS)
    .eq("household_id", ctx.household.id)
    .order("lesson_date", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(500);
  const lessons = withOwnership((data ?? []) as LessonRow[], ctx.user.id, ctx.members).map((l) => ({
    id: l.id,
    title: l.title,
    lesson_date: l.lesson_date,
    subject: l.subject,
    teacher: l.teacher,
    shared: l.shared,
    mine: l.mine,
    sharedBy: l.sharedBy,
    summary_status: l.summary_status,
  }));
  const enabled = carismaEnabled(ctx.household.id);
  const drive = enabled ? (await myDrive(db, ctx)).access : null;
  const { google } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Carisma</h2>
        <p className="text-sm text-muted">Aulas do seminário teológico: anotações, arquivos no seu Google Drive e resumo por IA.</p>
      </div>
      {drive && <DriveBanner access={drive} notice={googleNotice(google)} />}
      <LessonsView lessons={lessons} today={todaySP()} />
    </div>
  );
}
