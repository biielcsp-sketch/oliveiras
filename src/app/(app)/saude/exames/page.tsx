import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { EXAM_COLS, type HealthExam } from "@/lib/saude/types";
import { ExamsView, type ExamVM } from "../_components/exams-view";

export const metadata = { title: "Exames · Saúde" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db
    .from("health_exams")
    .select(EXAM_COLS)
    .eq("household_id", ctx.household.id)
    .order("exam_date", { ascending: false, nullsFirst: false })
    .limit(500);
  const people = ctx.members.map((m) => ({ id: m.id, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const exams: ExamVM[] = ((data ?? []) as HealthExam[]).map((x) => ({
    id: x.id,
    memberId: x.member_id,
    person: nameOf.get(x.member_id) ?? "",
    name: x.name,
    date: x.exam_date,
    lab: x.lab,
    requestedBy: x.requested_by,
    summary: x.result_summary,
    mime: x.file_mime,
    size: x.file_size,
  }));
  return <ExamsView people={people} exams={exams} defaultMember={ctx.me?.id ?? people[0]?.id ?? ""} />;
}
