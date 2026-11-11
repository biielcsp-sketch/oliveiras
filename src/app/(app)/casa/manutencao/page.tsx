import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { toSpDate } from "@/lib/agenda/dates";
import { MAINTENANCE_COLS, MAINTENANCE_LOG_COLS, num, type Maintenance, type MaintenanceLog } from "@/lib/casa/types";
import { MaintenanceView, type MaintenanceVM } from "../_components/maintenance-view";

export const metadata = { title: "Manutenção · Casa" };

const HISTORY_PER_ITEM = 10;

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const [{ data }, { data: logs }] = await Promise.all([
    db.from("casa_maintenance").select(MAINTENANCE_COLS).eq("household_id", ctx.household.id).eq("active", true).limit(200),
    db.from("casa_maintenance_log").select(MAINTENANCE_LOG_COLS).eq("household_id", ctx.household.id).order("done_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
  ]);
  const byItem = new Map<string, MaintenanceLog[]>();
  for (const l of (logs ?? []) as MaintenanceLog[]) {
    const list = byItem.get(l.maintenance_id) ?? [];
    if (list.length < HISTORY_PER_ITEM) byItem.set(l.maintenance_id, [...list, l]);
  }
  const items: MaintenanceVM[] = ((data ?? []) as Maintenance[]).map((m) => ({
    id: m.id,
    name: m.name,
    notes: m.notes,
    interval_value: m.interval_value,
    interval_unit: m.interval_unit,
    last_done_on: m.last_done_on,
    next_due_on: m.next_due_on,
    provider: m.provider,
    history: (byItem.get(m.id) ?? []).map((l) => ({ id: l.id, done_on: l.done_on, cost: num(l.cost), notes: l.notes })),
  }));
  return <MaintenanceView items={items} today={toSpDate(new Date())} />;
}
