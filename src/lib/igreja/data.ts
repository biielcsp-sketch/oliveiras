import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { withOwnership, type PrayerStatus, type PurposeStatus, type WordKind } from "./input";

/**
 * Leituras da Vida Devocional com a sessão (RLS: só o que é do usuário ou o que o cônjuge compartilhou).
 * `mine`/`sharedBy` vêm daqui (servidor) para a tela decidir se mostra os botões de editar.
 */
export const WORD_COLS = "id, owner_id, shared, kind, title, body, received_on, reference, fulfilled_on, created_at";
export const PRAYER_COLS = "id, owner_id, shared, title, person, details, status, answered_on, answer_notes, created_at";
export const PURPOSE_COLS = "id, owner_id, shared, title, description, status, starts_on, ends_on, notes, created_at";

export type Word = {
  id: string;
  owner_id: string;
  shared: boolean;
  kind: WordKind;
  title: string | null;
  body: string;
  received_on: string;
  reference: string | null;
  fulfilled_on: string | null;
  created_at: string;
};
export type Prayer = {
  id: string;
  owner_id: string;
  shared: boolean;
  title: string;
  person: string | null;
  details: string | null;
  status: PrayerStatus;
  answered_on: string | null;
  answer_notes: string | null;
  created_at: string;
};
export type Purpose = {
  id: string;
  owner_id: string;
  shared: boolean;
  title: string;
  description: string | null;
  status: PurposeStatus;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
  created_at: string;
};
export type WithOwner<T> = T & { mine: boolean; sharedBy: string | null };

export async function loadWords(kind: WordKind) {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db
    .from("igreja_words")
    .select(WORD_COLS)
    .eq("household_id", ctx.household.id)
    .eq("kind", kind)
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  return withOwnership((data ?? []) as Word[], ctx.user.id, ctx.members);
}

export async function loadPrayers() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("igreja_prayers").select(PRAYER_COLS).eq("household_id", ctx.household.id).order("created_at", { ascending: false }).limit(500);
  return withOwnership((data ?? []) as Prayer[], ctx.user.id, ctx.members);
}

export async function loadPurposes() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("igreja_purposes").select(PURPOSE_COLS).eq("household_id", ctx.household.id).order("created_at", { ascending: false }).limit(500);
  return withOwnership((data ?? []) as Purpose[], ctx.user.id, ctx.members);
}
