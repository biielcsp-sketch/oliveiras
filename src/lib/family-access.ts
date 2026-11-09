/**
 * "Família autorizada": recursos com custo ou credencial compartilhada (Oli, Agenda/Google)
 * só valem para a família configurada no servidor.
 * Ordem: variável própria do recurso → OLI_HOUSEHOLD_ID → PLUGGY_HOUSEHOLD_ID.
 * Vazio conta como ausente porque painéis de hospedagem costumam criar a variável sem valor.
 */
type Env = Record<string, string | undefined>;

export function authorizedFamilyId(env: Env = process.env, featureVar?: string) {
  return (featureVar ? env[featureVar]?.trim() : "") || env.OLI_HOUSEHOLD_ID?.trim() || env.PLUGGY_HOUSEHOLD_ID?.trim() || "";
}

export function familyAllowed(householdId: string | null | undefined, env: Env = process.env, featureVar?: string) {
  const allowed = authorizedFamilyId(env, featureVar);
  return Boolean(allowed) && Boolean(householdId) && allowed === householdId;
}

/** Agenda (Google Calendar): AGENDA_HOUSEHOLD_ID opcional; sem ela, vale a família do Oli. */
export function agendaAllowedFor(householdId: string | null | undefined, env: Env = process.env) {
  return familyAllowed(householdId, env, "AGENDA_HOUSEHOLD_ID");
}
