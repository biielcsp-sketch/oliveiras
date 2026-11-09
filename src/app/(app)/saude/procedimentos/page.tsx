import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PROCEDURE_COLS, type HealthProcedure } from "@/lib/saude/types";
import { sortProcedures } from "@/lib/saude/view";
import { ProceduresView, type ProcedureVM } from "../_components/procedures-view";

export const metadata = { title: "Procedimentos · Saúde" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("health_procedures").select(PROCEDURE_COLS).eq("household_id", ctx.household.id).limit(500);
  const people = ctx.members.map((m) => ({ id: m.id, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const items: ProcedureVM[] = sortProcedures((data ?? []) as HealthProcedure[]).map((x) => ({
    id: x.id,
    memberId: x.member_id,
    person: nameOf.get(x.member_id) ?? "",
    name: x.name,
    date: x.performed_on,
    place: x.place,
    doctor: x.doctor,
    notes: x.notes,
    mime: x.file_mime,
    size: x.file_size,
  }));
  return <ProceduresView people={people} items={items} defaultMember={ctx.me?.id ?? people[0]?.id ?? ""} />;
}
