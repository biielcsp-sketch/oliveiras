import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { getAppContext } from "@/lib/data";
import { agendaEnabled, createEvent, loadAccounts, removeEvent, updateEvent, writableCalendarsOf } from "@/lib/google/agenda";
import { appointmentEventInput } from "./agenda-link";
import type { HealthAppointment } from "./types";

type Ctx = Awaited<ReturnType<typeof getAppContext>>;

/**
 * Espelha a consulta na Agenda do Google. BEST-EFFORT: nunca lança e nunca bloqueia a consulta.
 * Devolve o id do evento (cal_events.id) a guardar em agenda_event_id, ou null se não sincronizou.
 * Não registra nada em log (erros do Google podem carregar detalhes da conta).
 */
export async function syncAppointmentToAgenda(ctx: Ctx, a: HealthAppointment): Promise<string | null> {
  try {
    if (!agendaEnabled(ctx.household.id)) return a.agenda_event_id;
    const db = await createClient();

    if (a.status === "cancelada") {
      if (!a.agenda_event_id) return null;
      const r = await removeEvent(ctx, a.agenda_event_id);
      // Falhou em remover: mantém o id para tentar de novo depois.
      return r.ok ? null : a.agenda_event_id;
    }
    // Realizada: o evento fica na Agenda como histórico.
    if (a.status !== "agendada") return a.agenda_event_id;

    const input = appointmentEventInput({
      ...a,
      memberName: ctx.members.find((m) => m.id === a.member_id)?.name ?? "Família",
    });
    if (!input) return a.agenda_event_id;

    if (a.agenda_event_id) {
      const { data: row } = await db
        .from("cal_events")
        .select("id")
        .eq("household_id", ctx.household.id)
        .eq("id", a.agenda_event_id)
        .maybeSingle();
      if (row) {
        const r = await updateEvent(ctx, a.agenda_event_id, input);
        return r.ok ? r.id : a.agenda_event_id;
      }
      // O evento sumiu da Agenda: cria outro.
    }
    const { accounts, calendars } = await loadAccounts(db, ctx.household.id);
    const cal = writableCalendarsOf(ctx, accounts, calendars)[0];
    if (!cal) return null;
    const r = await createEvent(ctx, cal.id, input);
    return r.ok ? r.id : null;
  } catch {
    return a.agenda_event_id;
  }
}

/** Apagou a consulta: tira o evento da Agenda (best-effort). */
export async function removeAppointmentFromAgenda(ctx: Ctx, eventId: string | null) {
  if (!eventId) return;
  try {
    if (agendaEnabled(ctx.household.id)) await removeEvent(ctx, eventId);
  } catch {
    /* best-effort */
  }
}
