import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { toSpDate } from "@/lib/agenda/dates";
import { CHORE_COLS, CHORE_LOG_COLS, type Chore, type ChoreLog } from "@/lib/casa/types";
import { cleanRotation, currentResponsible } from "@/lib/casa/schedule";
import { ChoresView, type ChoreVM } from "../_components/chores-view";

export const metadata = { title: "Tarefas · Casa" };

const HISTORY_PER_CHORE = 10;

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const [{ data: chores }, { data: logs }] = await Promise.all([
    db.from("casa_chores").select(CHORE_COLS).eq("household_id", ctx.household.id).eq("active", true).order("next_due_on").limit(200),
    db.from("casa_chore_log").select(CHORE_LOG_COLS).eq("household_id", ctx.household.id).order("done_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
  ]);
  const people = ctx.members.map((m) => ({ id: m.id, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const valid = new Set(nameOf.keys());
  const byChore = new Map<string, ChoreLog[]>();
  for (const l of (logs ?? []) as ChoreLog[]) {
    const list = byChore.get(l.chore_id) ?? [];
    if (list.length < HISTORY_PER_CHORE) byChore.set(l.chore_id, [...list, l]);
  }
  const items: ChoreVM[] = ((chores ?? []) as Chore[]).map((c) => {
    const responsible = currentResponsible(c, valid);
    const rotation = cleanRotation(c.rotation, valid);
    return {
      id: c.id,
      name: c.name,
      notes: c.notes,
      frequency: c.frequency,
      weekdays: c.weekdays,
      month_day: c.month_day,
      rotation,
      responsible: responsible ? (nameOf.get(responsible) ?? null) : null,
      validPeople: new Set(rotation).size,
      next_index: c.next_index,
      next_due_on: c.next_due_on,
      active: c.active,
      history: (byChore.get(c.id) ?? []).map((l) => ({ id: l.id, done_on: l.done_on, person: (l.member_id && nameOf.get(l.member_id)) || "—" })),
    };
  });
  return <ChoresView chores={items} people={people} today={toSpDate(new Date())} />;
}
