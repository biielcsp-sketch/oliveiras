export const MAX_HISTORY_TEXT = 4000;
export const MAX_SAVE_BATCH = 10;

export type HistoryInput = { role: "user" | "model"; text: string };

/** Normaliza o lote vindo do cliente: só user/model, sem vazias, cortado em 4000, máx. 10. */
export function cleanHistoryBatch(msgs: unknown): { role: "user" | "model"; content: string }[] {
  if (!Array.isArray(msgs)) return [];
  const out: { role: "user" | "model"; content: string }[] = [];
  for (const m of msgs.slice(0, MAX_SAVE_BATCH)) {
    if (!m || typeof m !== "object") continue;
    const { role, text } = m as Partial<HistoryInput>;
    if ((role !== "user" && role !== "model") || typeof text !== "string") continue;
    const content = text.trim().slice(0, MAX_HISTORY_TEXT);
    if (content) out.push({ role, content });
  }
  return out;
}

export type HistoryRow = { role: "user" | "model"; content: string; household_id: string; created_at: string };

/**
 * Linhas do insert com created_at ESTRITAMENTE crescente (1 ms por linha, na ordem do lote).
 * O horário vem do servidor, nunca do cliente; sem isso o now() do banco é igual para o lote inteiro
 * e o desempate por id aleatório poderia inverter fala e resposta.
 */
export function buildHistoryRows(msgs: unknown, householdId: string, now = Date.now()): HistoryRow[] {
  return cleanHistoryBatch(msgs).map((m, i) => ({
    ...m,
    household_id: householdId,
    created_at: new Date(now + i).toISOString(),
  }));
}
