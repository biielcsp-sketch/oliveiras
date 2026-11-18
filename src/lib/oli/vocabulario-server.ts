import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { buildCustomVocabulary, withFirstNames } from "./vocabulario";

type Db = Awaited<ReturnType<typeof createClient>>;

/** Quantos nomes de cada fonte entram (antes do teto de 100 da lista final). */
const LIMITS = { members: 12, pets: 10, medications: 20, bills: 30, oneOff: 20, purposes: 10, lessons: 10 } as const;

type Rows = { data: Record<string, unknown>[] | null };

const col = (r: Rows, key: string) => (r.data ?? []).map((row) => row[key]);

/**
 * Vocabulário da sessão do Oli com os nomes da PRÓPRIA família, lidos com a sessão do usuário (RLS) e filtrados
 * pela família do usuário: pessoas, pets, remédios ativos, contas fixas e avulsas, propósitos e aulas recentes
 * (propósitos e aulas privados do cônjuge já ficam de fora pelo RLS). Fonte que falhar fica vazia (o token não cai).
 * Nada daqui vai para log.
 */
export async function loadOliVocabulary(db: Db, householdId: string): Promise<string[]> {
  const safe = async (q: PromiseLike<Rows>): Promise<Rows> => {
    try {
      const r = await q;
      return { data: Array.isArray(r.data) ? r.data : [] };
    } catch {
      return { data: [] };
    }
  };
  const [members, pets, meds, bills, oneOff, purposes, lessons] = await Promise.all([
    safe(db.from("members").select("name").eq("household_id", householdId).order("name").limit(LIMITS.members)),
    safe(db.from("casa_pets").select("name").eq("household_id", householdId).order("name").limit(LIMITS.pets)),
    safe(db.from("health_medications").select("name").eq("household_id", householdId).eq("active", true).order("name").limit(LIMITS.medications)),
    safe(db.from("fin_bills").select("name").eq("household_id", householdId).eq("active", true).order("name").limit(LIMITS.bills)),
    safe(db.from("fin_one_off_bills").select("name").eq("household_id", householdId).order("due_date", { ascending: false }).limit(LIMITS.oneOff)),
    safe(db.from("igreja_purposes").select("title").eq("household_id", householdId).order("created_at", { ascending: false }).limit(LIMITS.purposes)),
    safe(db.from("igreja_carisma_lessons").select("title").eq("household_id", householdId).order("created_at", { ascending: false }).limit(LIMITS.lessons)),
  ]);
  return buildCustomVocabulary([
    withFirstNames(col(members, "name")),
    col(pets, "name"),
    col(meds, "name"),
    col(bills, "name"),
    col(oneOff, "name"),
    col(purposes, "title"),
    col(lessons, "title"),
  ]);
}
