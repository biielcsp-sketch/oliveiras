import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { getAppContext } from "@/lib/data";
import { agendaEnabled } from "@/lib/google/agenda";
import { agendaSyncState, type AgendaSyncState } from "./agenda-state";
import { syncAppointmentToAgenda } from "./agenda-sync";
import { APPOINTMENT_COLS, type HealthAppointment } from "./types";
import type { AppointmentInput } from "./input";

type Db = Awaited<ReturnType<typeof createClient>>;
type Ctx = Awaited<ReturnType<typeof getAppContext>>;

/** Grava o resultado da sincronização com a Agenda (best-effort, nunca derruba a consulta). */
export async function storeAgendaId(db: Db, householdId: string, a: HealthAppointment, eventId: string | null) {
  if (eventId === a.agenda_event_id) return;
  await db.from("health_appointments").update({ agenda_event_id: eventId }).eq("household_id", householdId).eq("id", a.id);
}

/**
 * Consulta nova (já validada por validateAppointmentInput): insere com a sessão do usuário e o household do servidor,
 * espelha na Agenda (best-effort) e guarda o id do evento. Usada pelo formulário de Saúde e pelo Oli.
 */
export async function insertAppointment(
  db: Db,
  ctx: Ctx,
  value: AppointmentInput,
): Promise<{ ok: true; saved: HealthAppointment; agenda: AgendaSyncState } | { ok: false }> {
  const { data, error } = await db
    .from("health_appointments")
    .insert({ ...value, household_id: ctx.household.id })
    .select(APPOINTMENT_COLS)
    .single();
  if (error || !data) return { ok: false };
  const saved = data as HealthAppointment;
  const eventId = await syncAppointmentToAgenda(ctx, saved);
  await storeAgendaId(db, ctx.household.id, saved, eventId);
  return { ok: true, saved, agenda: agendaSyncState(agendaEnabled(ctx.household.id), eventId) };
}
