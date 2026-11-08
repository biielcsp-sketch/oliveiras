/**
 * Só a família autorizada usa o Oli (cada sessão do Gemini Live tem custo).
 * OLI_HOUSEHOLD_ID; se ausente OU vazio (""), vale a mesma família da Pluggy (PLUGGY_HOUSEHOLD_ID).
 * Vazio conta como ausente porque painéis de hospedagem costumam criar a variável sem valor.
 */
export function oliAllowedFor(householdId: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  const allowed = env.OLI_HOUSEHOLD_ID?.trim() || env.PLUGGY_HOUSEHOLD_ID?.trim();
  return Boolean(allowed) && Boolean(householdId) && allowed === householdId;
}

export const OLI_DEFAULT_MODEL = "gemini-3.8-live";
export const OLI_DEFAULT_VOICE = "Puck";
/** Versão da API para criar o token efêmero e conectar (doc do Google: tokens efêmeros só na v1beta). */
export const OLI_API_VERSION = "v1beta";
