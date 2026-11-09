import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { MEDICATION_COLS, type HealthMedication } from "@/lib/saude/types";
import { MedicationsView, type MedicationVM } from "../_components/medications-view";

export const metadata = { title: "Medicamentos · Saúde" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db
    .from("health_medications")
    .select(MEDICATION_COLS)
    .eq("household_id", ctx.household.id)
    .order("started_on", { ascending: false, nullsFirst: false })
    .limit(500);
  const people = ctx.members.map((m) => ({ id: m.id, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const items: MedicationVM[] = ((data ?? []) as HealthMedication[]).map((x) => ({
    id: x.id,
    memberId: x.member_id,
    person: nameOf.get(x.member_id) ?? "",
    name: x.name,
    dosage: x.dosage,
    frequency: x.frequency,
    startedOn: x.started_on,
    endedOn: x.ended_on,
    active: x.active,
    prescribedBy: x.prescribed_by,
    notes: x.notes,
  }));
  return <MedicationsView people={people} items={items} defaultMember={ctx.me?.id ?? people[0]?.id ?? ""} />;
}
