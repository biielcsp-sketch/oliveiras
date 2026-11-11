import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { CARD_COLS, type HealthCard } from "@/lib/saude/types";
import type { OfflineCard } from "@/lib/saude/offline-cards";
import { OfflineCardsSync } from "@/components/offline-cards";
import { CardsView, type CardVM } from "./_components/cards-view";

export const metadata = { title: "Saúde" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("health_insurance_cards").select(CARD_COLS).eq("household_id", ctx.household.id).order("created_at");
  const rows = (data ?? []) as HealthCard[];
  const people = ctx.members.map((m) => ({ id: m.id, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const cards: CardVM[] = rows.map((c) => ({
    id: c.id,
    memberId: c.member_id,
    operator: c.operator,
    number: c.card_number,
    plan: c.plan_name,
    validUntil: c.valid_until,
    notes: c.notes,
    mime: c.file_mime,
    size: c.file_size,
  }));
  // Mínimo guardado no aparelho para uso offline: operadora, pessoa, número e o arquivo.
  const offline: OfflineCard[] = rows.map((c) => ({
    id: c.id,
    operator: c.operator,
    person: nameOf.get(c.member_id) ?? "",
    number: c.card_number,
    mime: c.file_mime,
    updatedAt: c.updated_at,
  }));

  return (
    <>
      <OfflineCardsSync userId={ctx.user.id} cards={offline} />
      <CardsView people={people} cards={cards} defaultMember={ctx.me?.id ?? people[0]?.id ?? ""} />
    </>
  );
}
