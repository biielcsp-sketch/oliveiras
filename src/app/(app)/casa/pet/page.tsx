import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { toSpDate } from "@/lib/agenda/dates";
import { num, PROVIDER_COLS, type Provider } from "@/lib/casa/types";
import { providerContact } from "@/lib/casa/contacts";
import {
  PET_CARE_COLS,
  PET_CARE_LOG_COLS,
  PET_COLS,
  PET_FOOD_COLS,
  PET_HEALTH_COLS,
  PET_VET_COLS,
  PET_WEIGHT_COLS,
  pickPet,
  sortPets,
  type Pet,
  type PetCare,
  type PetCareLog,
  type PetFood,
  type PetHealth,
  type PetVet,
  type PetWeight,
} from "@/lib/casa/pet";
import { PetView, type PetData } from "../_components/pet-view";

export const metadata = { title: "Pet · Casa" };

const HISTORY_PER_CARE = 10;

/** Um pet: abre direto nele. Mais de um: seletor (?pet=id; id de outra família cai no primeiro da lista). */
export default async function Page({ searchParams }: { searchParams: Promise<{ pet?: string }> }) {
  const requested = (await searchParams).pet;
  const ctx = await getAppContext();
  const db = await createClient();
  const hh = ctx.household.id;
  const today = toSpDate(new Date());

  const [{ data: petRows }, { data: provs }] = await Promise.all([
    db.from("casa_pets").select(PET_COLS).eq("household_id", hh).limit(50),
    db.from("casa_providers").select(PROVIDER_COLS).eq("household_id", hh).order("name").limit(500),
  ]);
  const pets = sortPets((petRows ?? []) as Pet[]);
  const providers = (provs ?? []) as Provider[];
  const pet = pickPet(pets, requested);
  if (!pet) return <PetView pets={[]} data={null} providers={[]} today={today} />;

  const [health, vet, care, weights, food] = await Promise.all([
    db.from("casa_pet_health").select(PET_HEALTH_COLS).eq("household_id", hh).eq("pet_id", pet.id).limit(500),
    db.from("casa_pet_vet").select(PET_VET_COLS).eq("household_id", hh).eq("pet_id", pet.id).order("happened_on", { ascending: false }).limit(200),
    db.from("casa_pet_care").select(PET_CARE_COLS).eq("household_id", hh).eq("pet_id", pet.id).eq("active", true).limit(100),
    db.from("casa_pet_weights").select(PET_WEIGHT_COLS).eq("household_id", hh).eq("pet_id", pet.id).order("measured_on", { ascending: false }).limit(60),
    db.from("casa_pet_food").select(PET_FOOD_COLS).eq("household_id", hh).eq("pet_id", pet.id).order("started_on", { ascending: false }).limit(20),
  ]);

  const byProvider = new Map(providers.map((p) => [p.id, p]));
  const careIds = ((care.data ?? []) as PetCare[]).map((c) => c.id);
  const logs = careIds.length
    ? await db
        .from("casa_pet_care_log")
        .select(PET_CARE_LOG_COLS)
        .eq("household_id", hh)
        .in("care_id", careIds)
        .order("done_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] };
  const byCare = new Map<string, PetCareLog[]>();
  for (const l of (logs.data ?? []) as PetCareLog[]) {
    const list = byCare.get(l.care_id) ?? [];
    if (list.length < HISTORY_PER_CARE) byCare.set(l.care_id, [...list, l]);
  }

  const data: PetData = {
    pet,
    health: ((health.data ?? []) as PetHealth[]).map((h) => ({ ...h, file_size: num(h.file_size) })),
    vet: ((vet.data ?? []) as PetVet[]).map((v) => ({ ...v, cost: num(v.cost), file_size: num(v.file_size) })),
    care: ((care.data ?? []) as PetCare[]).map((c) => ({
      ...c,
      interval_value: Number(c.interval_value),
      // Contato do prestador: links de ligar/WhatsApp montados no servidor (só dígitos).
      contact: c.provider_id && byProvider.has(c.provider_id) ? providerContact(byProvider.get(c.provider_id)!) : null,
      history: (byCare.get(c.id) ?? []).map((l) => ({ ...l, cost: num(l.cost) })),
    })),
    weights: ((weights.data ?? []) as PetWeight[]).map((w) => ({ ...w, weight_kg: Number(w.weight_kg) })),
    food: ((food.data ?? []) as PetFood[]).map((f) => ({ ...f, bag_kg: Number(f.bag_kg), daily_grams: num(f.daily_grams) })),
  };

  return (
    <PetView
      pets={pets.map((p) => ({ id: p.id, name: p.name }))}
      data={data}
      providers={providers.map((p) => ({ id: p.id, name: p.name, service: p.service }))}
      today={today}
    />
  );
}
