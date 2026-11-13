import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { spDayStartIso } from "@/lib/financas/documentos/rules";
import { todaySP } from "@/lib/financas/today";
import { oliFileLimitError } from "./arquivo";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Limite diário de leituras de arquivo do Oli (o "+" e o ler_arquivo contam juntos, 30 por família por dia).
 * Registra 1 leitura em oli_file_reads (só household_id; created_at/created_by vêm do banco e o usuário não
 * apaga nem altera) e conta as da família desde a meia-noite de São Paulo, já com esta. Erro = recusa.
 * Sempre ANTES de baixar o arquivo e de chamar a IA. Com a sessão do usuário (RLS).
 */
export async function checkDailyLimit(db: Db, householdId: string): Promise<string | null> {
  const { error: insertError } = await db.from("oli_file_reads").insert({ household_id: householdId });
  if (insertError) return oliFileLimitError({ registered: false, countToday: null });
  const { count, error } = await db
    .from("oli_file_reads")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .gte("created_at", spDayStartIso(todaySP()));
  return oliFileLimitError({ registered: true, countToday: error ? null : count });
}
