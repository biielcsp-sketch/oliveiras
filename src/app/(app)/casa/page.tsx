import Link from "next/link";
import { ListChecks, Package, ShoppingCart, Wrench, type LucideIcon } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { toSpDate } from "@/lib/agenda/dates";
import { Card } from "@/components/ui";
import { num } from "@/lib/casa/types";
import { choreBuckets, expiryStatus, isLow, maintenanceStatus } from "@/lib/casa/view";

export const metadata = { title: "Casa" };

function Tile({ href, icon: Icon, title, lines, testId }: { href: string; icon: LucideIcon; title: string; lines: string[]; testId: string }) {
  return (
    <Link href={href} className="block" data-testid={testId}>
      <Card className="flex h-full items-start gap-4 transition hover:brightness-105">
        <span className="grid size-12 shrink-0 place-items-center rounded-full border border-line bg-accent-soft text-primary">
          <Icon size={22} aria-hidden />
        </span>
        <div>
          <p className="text-lg font-semibold tracking-tight">{title}</p>
          {lines.map((l) => (
            <p key={l} className="text-sm text-muted">
              {l}
            </p>
          ))}
        </div>
      </Card>
    </Link>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Resumo da Casa: lista de compras, despensa, tarefas de hoje/atrasadas e manutenções vencidas. */
export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const hh = ctx.household.id;
  const today = toSpDate(new Date());
  const [shopping, pantry, chores, maint] = await Promise.all([
    db.from("casa_shopping_items").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("done", false),
    db.from("casa_pantry_items").select("quantity, min_quantity, expires_on").eq("household_id", hh).limit(1000),
    db.from("casa_chores").select("active, next_due_on").eq("household_id", hh).eq("active", true).limit(500),
    db.from("casa_maintenance").select("next_due_on").eq("household_id", hh).eq("active", true).limit(500),
  ]);

  const pantryRows = (pantry.data ?? []).map((p) => ({ quantity: num(p.quantity) ?? 0, min_quantity: num(p.min_quantity) ?? 0, expires_on: p.expires_on as string | null }));
  const low = pantryRows.filter(isLow).length;
  const expiring = pantryRows.filter((p) => expiryStatus(p.expires_on, today)).length;
  const b = choreBuckets((chores.data ?? []) as { active: boolean; next_due_on: string | null }[], today);
  const mStatus = (maint.data ?? []).map((m) => maintenanceStatus(m.next_due_on as string | null, today));
  const overdueM = mStatus.filter((s) => s === "vencida").length;
  const soonM = mStatus.filter((s) => s === "em-breve").length;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Tile
        href="/casa/compras"
        icon={ShoppingCart}
        title="Lista de compras"
        testId="resumo-compras"
        lines={[shopping.count ? plural(shopping.count, "item para comprar", "itens para comprar") : "Nada para comprar."]}
      />
      <Tile
        href="/casa/despensa"
        icon={Package}
        title="Despensa"
        testId="resumo-despensa"
        lines={low || expiring ? [plural(low, "item acabando", "itens acabando"), plural(expiring, "item vencendo", "itens vencendo")] : ["Tudo em dia."]}
      />
      <Tile
        href="/casa/tarefas"
        icon={ListChecks}
        title="Tarefas"
        testId="resumo-tarefas"
        lines={[plural(b.today.length, "tarefa para hoje", "tarefas para hoje"), plural(b.overdue.length, "atrasada", "atrasadas")]}
      />
      <Tile
        href="/casa/manutencao"
        icon={Wrench}
        title="Manutenção"
        testId="resumo-manutencao"
        lines={[plural(overdueM, "vencida", "vencidas"), plural(soonM, "nos próximos 15 dias", "nos próximos 15 dias")]}
      />
    </div>
  );
}
