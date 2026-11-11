import Link from "next/link";
import { FileText, ListChecks, PawPrint, Phone, Receipt, ShoppingCart, UtensilsCrossed, Wrench, type LucideIcon } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { brDate, toSpDate } from "@/lib/agenda/dates";
import { Card } from "@/components/ui";
import { choreBuckets, maintenanceStatus } from "@/lib/casa/view";
import { homeBillCounts, homeBillsForMonth } from "@/lib/casa/contas";
import { warrantyAlerts } from "@/lib/casa/docs";
import { MEALS, MEAL_LABEL, type Meal } from "@/lib/casa/types";
import { petSummary } from "@/lib/casa/pet";
import { getBillPayments, getBills } from "@/lib/financas/planning-data";
import { getConfirmedBillDocs } from "@/lib/financas/documentos/data";
import { currentMonth } from "@/lib/financas/period";

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

/** Resumo da Casa: compras, pet, tarefas, manutenções, contas da casa do mês, garantias, cardápio de hoje e prestadores. */
export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const hh = ctx.household.id;
  const today = toSpDate(new Date());
  const month = currentMonth();
  const [shopping, chores, maint, bills, payments, billDocs, docs, meals, providers, pets, petHealth, petCare, petFood] = await Promise.all([
    db.from("casa_shopping_items").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("done", false),
    db.from("casa_chores").select("active, next_due_on").eq("household_id", hh).eq("active", true).limit(500),
    db.from("casa_maintenance").select("next_due_on").eq("household_id", hh).eq("active", true).limit(500),
    getBills(),
    getBillPayments(month),
    getConfirmedBillDocs(month),
    db.from("casa_documents").select("warranty_until").eq("household_id", hh).not("warranty_until", "is", null).limit(1000),
    db.from("casa_meal_plan").select("meal, title").eq("household_id", hh).eq("day", today).limit(10),
    db.from("casa_providers").select("id", { count: "exact", head: true }).eq("household_id", hh),
    db.from("casa_pets").select("id, name").eq("household_id", hh).limit(50),
    db.from("casa_pet_health").select("id, pet_id, kind, name, dose, applied_on, next_due_on, created_at").eq("household_id", hh).order("created_at", { ascending: false }).limit(2000),
    db.from("casa_pet_care").select("active, next_due_on").eq("household_id", hh).eq("active", true).limit(500),
    db.from("casa_pet_food").select("pet_id, bag_kg, daily_grams, started_on").eq("household_id", hh).eq("active", true).limit(100),
  ]);

  const b = choreBuckets((chores.data ?? []) as { active: boolean; next_due_on: string | null }[], today);
  const mStatus = (maint.data ?? []).map((m) => maintenanceStatus(m.next_due_on as string | null, today));
  const overdueM = mStatus.filter((s) => s === "vencida").length;
  const soonM = mStatus.filter((s) => s === "em-breve").length;
  const billCounts = homeBillCounts(homeBillsForMonth({ bills, payments, docs: billDocs, month, today }));
  const w = warrantyAlerts((docs.data ?? []) as { warranty_until: string | null }[], today);
  const pet = petSummary(
    {
      pets: (pets.data ?? []) as { id: string; name: string }[],
      health: (petHealth.data ?? []) as Parameters<typeof petSummary>[0]["health"],
      care: (petCare.data ?? []) as { active: boolean; next_due_on: string | null }[],
      food: ((petFood.data ?? []) as { pet_id: string; bag_kg: number; daily_grams: number | null; started_on: string }[]).map((f) => ({
        ...f,
        bag_kg: Number(f.bag_kg),
        daily_grams: f.daily_grams === null ? null : Number(f.daily_grams),
      })),
    },
    today,
    brDate,
  );
  const todayMeals = ((meals.data ?? []) as { meal: Meal; title: string }[]).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Tile
        href="/casa/compras"
        icon={ShoppingCart}
        title="Lista de compras"
        testId="resumo-compras"
        lines={[shopping.count ? plural(shopping.count, "item para comprar", "itens para comprar") : "Nada para comprar."]}
      />
      <Tile href="/casa/pet" icon={PawPrint} title="Pet" testId="resumo-pet" lines={pet} />
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
      <Tile
        href="/casa/contas"
        icon={Receipt}
        title="Contas da casa"
        testId="resumo-contas"
        lines={
          billCounts.open || billCounts.late
            ? [plural(billCounts.open, "em aberto", "em aberto"), plural(billCounts.late, "atrasada", "atrasadas")]
            : ["Nenhuma conta em aberto no mês."]
        }
      />
      <Tile
        href="/casa/documentos"
        icon={FileText}
        title="Documentos"
        testId="resumo-documentos"
        lines={
          w.soon.length || w.expired.length
            ? [plural(w.soon.length, "garantia vencendo", "garantias vencendo"), plural(w.expired.length, "garantia vencida", "garantias vencidas")]
            : ["Nenhuma garantia vencendo."]
        }
      />
      <Tile
        href="/casa/cardapio"
        icon={UtensilsCrossed}
        title="Cardápio"
        testId="resumo-cardapio"
        lines={todayMeals.length ? todayMeals.map((m) => `${MEAL_LABEL[m.meal]}: ${m.title}`) : ["Nada planejado para hoje."]}
      />
      <Tile
        href="/casa/prestadores"
        icon={Phone}
        title="Prestadores"
        testId="resumo-prestadores"
        lines={[providers.count ? plural(providers.count, "contato", "contatos") : "Nenhum contato ainda."]}
      />
    </div>
  );
}
