import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { telHref, whatsappHref } from "@/lib/casa/contacts";
import { PROVIDER_COLS, type Provider } from "@/lib/casa/types";
import { ProvidersView, type ProviderVM } from "../_components/providers-view";

export const metadata = { title: "Prestadores · Casa" };

export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const { data } = await db.from("casa_providers").select(PROVIDER_COLS).eq("household_id", ctx.household.id).order("name").limit(500);
  // Links de ligar/WhatsApp montados aqui, só com os dígitos do telefone.
  const items: ProviderVM[] = ((data ?? []) as Provider[]).map((p) => ({ ...p, tel: telHref(p.phone), whatsapp: whatsappHref(p.phone) }));
  return <ProvidersView items={items} />;
}
