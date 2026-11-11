import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { APPOINTMENT_COLS, type HealthAppointment } from "@/lib/saude/types";
import { splitAppointments, toInputLocal, whenLabel } from "@/lib/saude/view";
import { AppointmentsView, type AppointmentVM } from "../_components/appointments-view";

export const metadata = { title: "Consultas · Saúde" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("health_appointments").select(APPOINTMENT_COLS).eq("household_id", ctx.household.id).limit(1000);
  const rows = (data ?? []) as HealthAppointment[];
  const people = ctx.members.map((m) => ({ id: m.id, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const byId = new Map(rows.map((a) => [a.id, a]));
  const label = (a: HealthAppointment) => `${a.specialty ?? "Consulta"} — ${whenLabel(a.starts_at)} (${nameOf.get(a.member_id) ?? ""})`;

  const vm = (a: HealthAppointment): AppointmentVM => {
    const origin = a.return_of ? byId.get(a.return_of) : undefined;
    return {
      id: a.id,
      memberId: a.member_id,
      person: nameOf.get(a.member_id) ?? "",
      kind: a.kind,
      specialty: a.specialty,
      doctor: a.doctor,
      place: a.place,
      local: toInputLocal(a.starts_at),
      whenLabel: whenLabel(a.starts_at),
      status: a.status,
      notes: a.notes,
      returnOf: a.return_of,
      originLabel: origin ? label(origin) : null,
      synced: a.agenda_event_id !== null,
    };
  };
  const { upcoming, past } = splitAppointments(rows);
  const origins = rows
    .filter((a) => a.kind === "consulta")
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
    .map((a) => ({ id: a.id, memberId: a.member_id, label: label(a) }));

  return (
    <AppointmentsView
      people={people}
      upcoming={upcoming.map(vm)}
      past={past.map(vm)}
      origins={origins}
      defaultMember={ctx.me?.id ?? people[0]?.id ?? ""}
    />
  );
}
