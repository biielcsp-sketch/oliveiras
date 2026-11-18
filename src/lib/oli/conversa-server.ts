import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { spMidnightIso } from "@/lib/agenda/dates";
import { buildConversa, CONVERSA_LIMITE, conversaRange, ilikePattern, type BuscarConversaArgs, type ConversaData, type ConversaRow } from "./conversa";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Busca nas mensagens da própria pessoa com a sessão dela (RLS: user_id = auth.uid()); o filtro por user_id
 * repete a regra no pedido. Nunca chave de serviço; o conteúdo não vai para log.
 */
export async function buscarConversa(db: Db, userId: string, a: BuscarConversaArgs): Promise<ConversaData | null> {
  const range = conversaRange(a, spMidnightIso);
  let q = db
    .from("oli_messages")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .ilike("content", ilikePattern(a.termo));
  if (range.gte) q = q.gte("created_at", range.gte);
  if (range.lt) q = q.lt("created_at", range.lt);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(CONVERSA_LIMITE);
  if (error) return null;
  return buildConversa((data ?? []) as ConversaRow[], a);
}
