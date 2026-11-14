import "server-only";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { brDate, toSpDate } from "@/lib/agenda/dates";
import { choreBuckets, maintenanceStatus } from "@/lib/casa/view";
import { homeBillCounts, homeBillsForMonth } from "@/lib/casa/contas";
import { warrantyAlerts } from "@/lib/casa/docs";
import { MEALS, MEAL_LABEL, type Meal } from "@/lib/casa/types";
import { petSummary } from "@/lib/casa/pet";
import { petTileLines } from "@/lib/summary-tile";
import { getBillPayments, getBills, getOneOffBillsForMonth } from "@/lib/financas/planning-data";
import { getConfirmedBillDocs } from "@/lib/financas/documentos/data";
import { currentMonth } from "@/lib/financas/period";

/** Card do Resumo da Casa (sem ícone: o componente escolhe pelo `key`). `pet`: usa os alertas do Pet. */
export type CasaTile = { key: "compras" | "pet" | "tarefas" | "manutencao" | "contas" | "documentos" | "cardapio" | "prestadores"; href: string; title: string; testId: string; lines: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Dados do Resumo da Casa (compras, pet, tarefas, manutenções, contas da casa do mês, garantias, cardápio de hoje e
 * prestadores), com a sessão do usuário (RLS). Usado na página da Casa e no painel do Início.
 */
export async function getCasaResumo(): Promise<CasaTile[]> {
  const ctx = await getAppContext();
  const db = await createClient();
  const hh = ctx.household.id;
  const today = toSpDate(new Date());
  const month = currentMonth();
  const [shopping, chores, maint, bills, payments, billDocs, docs, meals, providers, pets, petHealth, petCare, petFood, oneOffs] = await Promise.all([
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
    getOneOffBillsForMonth(month),
  ]);

  const b = choreBuckets((chores.data ?? []) as { active: boolean; next_due_on: string | null }[], today);
  const mStatus = (maint.data ?? []).map((m) => maintenanceStatus(m.next_due_on as string | null, today));
  const overdueM = mStatus.filter((s) => s === "vencida").length;
  const soonM = mStatus.filter((s) => s === "em-breve").length;
  // Avulsas da casa do mês contam junto das fixas da casa (homeBillsForMonth filtra is_home).
  const billCounts = homeBillCounts(homeBillsForMonth({ bills, payments, docs: billDocs, oneOffs, month, today }));
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

  return [
    { key: "compras", href: "/casa/compras", title: "Lista de compras", testId: "resumo-compras", lines: [shopping.count ? plural(shopping.count, "item para comprar", "itens para comprar") : "Nada para comprar."] },
    { key: "pet", href: "/casa/pet", title: "Pet", testId: "resumo-pet", lines: petTileLines(pet) },
    { key: "tarefas", href: "/casa/tarefas", title: "Tarefas", testId: "resumo-tarefas", lines: [plural(b.today.length, "tarefa para hoje", "tarefas para hoje"), plural(b.overdue.length, "atrasada", "atrasadas")] },
    { key: "manutencao", href: "/casa/manutencao", title: "Manutenção", testId: "resumo-manutencao", lines: [plural(overdueM, "vencida", "vencidas"), plural(soonM, "nos próximos 15 dias", "nos próximos 15 dias")] },
    {
      key: "contas",
      href: "/casa/contas",
      title: "Contas da casa",
      testId: "resumo-contas",
      lines: billCounts.open || billCounts.late ? [plural(billCounts.open, "em aberto", "em aberto"), plural(billCounts.late, "atrasada", "atrasadas")] : ["Nenhuma conta em aberto no mês."],
    },
    {
      key: "documentos",
      href: "/casa/documentos",
      title: "Documentos",
      testId: "resumo-documentos",
      lines: w.soon.length || w.expired.length ? [plural(w.soon.length, "garantia vencendo", "garantias vencendo"), plural(w.expired.length, "garantia vencida", "garantias vencidas")] : ["Nenhuma garantia vencendo."],
    },
    { key: "cardapio", href: "/casa/cardapio", title: "Cardápio", testId: "resumo-cardapio", lines: todayMeals.length ? todayMeals.map((m) => `${MEAL_LABEL[m.meal]}: ${m.title}`) : ["Nada planejado para hoje."] },
    { key: "prestadores", href: "/casa/prestadores", title: "Prestadores", testId: "resumo-prestadores", lines: [providers.count ? plural(providers.count, "contato", "contatos") : "Nenhum contato ainda."] },
  ];
}
