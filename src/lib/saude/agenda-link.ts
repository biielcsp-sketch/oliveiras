/** Consulta → evento da Agenda (função pura). Duração padrão de 1 hora. */
import { toSpLocal } from "@/lib/agenda/dates";
import { validateEventInput } from "@/lib/agenda/input";
import type { EventInput } from "@/lib/agenda/google-events";
import type { AppointmentKind } from "./types";

export function appointmentEventInput(a: {
  kind: AppointmentKind;
  specialty: string | null;
  doctor: string | null;
  place: string | null;
  notes: string | null;
  starts_at: string;
  memberName: string;
}): EventInput | null {
  const label = a.kind === "retorno" ? "Retorno" : "Consulta";
  const title = `${label}${a.specialty ? ` — ${a.specialty}` : ""} (${a.memberName})`;
  const description = [a.doctor ? `Médico: ${a.doctor}` : "", a.notes ?? ""].filter(Boolean).join("\n");
  const r = validateEventInput({ title, allDay: false, start: toSpLocal(a.starts_at), location: a.place ?? "", description });
  return r.ok ? r.value : null;
}
