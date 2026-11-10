import { familyAllowed } from "@/lib/family-access";

/**
 * Leitura com IA (Gemini pago) só para a família autorizada, como o Oli e a Agenda.
 * DOCS_HOUSEHOLD_ID opcional; sem ela, OLI_HOUSEHOLD_ID → PLUGGY_HOUSEHOLD_ID.
 * As outras famílias enviam e guardam o arquivo normalmente, mas preenchem à mão.
 */
export function docsAiAllowedFor(householdId: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  return familyAllowed(householdId, env, "DOCS_HOUSEHOLD_ID");
}
