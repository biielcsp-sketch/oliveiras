"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { buildHistoryRows, type HistoryInput } from "@/lib/oli/history-input";

/** Histórico da conversa com o Oli: privado por pessoa (RLS), sempre com a sessão do usuário. */

export async function saveOliMessages(msgs: HistoryInput[]): Promise<{ ok: boolean }> {
  const { household } = await getAppContext();
  try {
    const rows = buildHistoryRows(msgs, household.id);
    if (rows.length === 0) return { ok: true };
    const supabase = await createClient();
    // user_id vem do default auth.uid() no banco; o RLS garante que só grava como a própria pessoa.
    const { error } = await supabase.from("oli_messages").insert(rows);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function clearOliHistory(): Promise<{ ok: boolean }> {
  const { user } = await getAppContext();
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("oli_messages").delete().eq("user_id", user.id);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
