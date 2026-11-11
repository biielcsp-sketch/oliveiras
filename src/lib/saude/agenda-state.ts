export type AgendaSyncState = "sincronizada" | "desligada" | "falhou";

/** Agenda desligada para a família não é falha; só avisa quando estava ligada e não sincronizou. */
export function agendaSyncState(enabled: boolean, eventId: string | null): AgendaSyncState {
  if (!enabled) return "desligada";
  return eventId ? "sincronizada" : "falhou";
}
