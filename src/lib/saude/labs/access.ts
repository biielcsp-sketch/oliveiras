import { familyAllowed } from "@/lib/family-access";

/**
 * Leitura de exames de laboratório com IA (Gemini pago) só para a família autorizada, como o Oli e a Agenda.
 * LABS_HOUSEHOLD_ID opcional; sem ela, OLI_HOUSEHOLD_ID → PLUGGY_HOUSEHOLD_ID.
 */
export function labsAiAllowedFor(householdId: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  return familyAllowed(householdId, env, "LABS_HOUSEHOLD_ID");
}
