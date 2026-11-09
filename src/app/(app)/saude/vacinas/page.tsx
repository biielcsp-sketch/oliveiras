import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { toSpDate } from "@/lib/agenda/dates";
import { VACCINE_COLS, type HealthVaccine } from "@/lib/saude/types";
import { sortVaccines } from "@/lib/saude/view";
import { VaccinesView, type VaccineVM } from "../_components/vaccines-view";

export const metadata = { title: "Vacinas · Saúde" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("health_vaccines").select(VACCINE_COLS).eq("household_id", ctx.household.id).limit(1000);
  // Filho(s) primeiro: é quem mais precisa do controle de vacinas.
  const ordered = [...ctx.members].sort((a, b) => Number(b.relation === "filho") - Number(a.relation === "filho"));
  const people = ordered.map((m) => ({ id: m.id, name: m.name, child: m.relation === "filho" }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const items: VaccineVM[] = sortVaccines((data ?? []) as HealthVaccine[]).map((x) => ({
    id: x.id,
    memberId: x.member_id,
    person: nameOf.get(x.member_id) ?? "",
    name: x.name,
    dose: x.dose_label,
    appliedOn: x.applied_on,
    nextDoseOn: x.next_dose_on,
    place: x.place,
    lot: x.lot,
    notes: x.notes,
    mime: x.file_mime,
    size: x.file_size,
  }));
  return <VaccinesView people={people} items={items} defaultMember={ctx.me?.id ?? people[0]?.id ?? ""} today={toSpDate(new Date())} />;
}
