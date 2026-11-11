import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export type HistoryMessage = { id: string; role: "user" | "model"; content: string };

/**
 * Últimas mensagens da pessoa (RLS: só as dela), em ordem cronológica.
 * Nunca lança: sem histórico é melhor que derrubar a página ou o token.
 */
export async function getRecentOliMessages(db: Db, limit: number): Promise<HistoryMessage[]> {
  try {
    const { data, error } = await db
      .from("oli_messages")
      .select("id, role, content")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as HistoryMessage[])
      .filter((m) => (m.role === "user" || m.role === "model") && typeof m.content === "string")
      .reverse();
  } catch {
    return [];
  }
}
