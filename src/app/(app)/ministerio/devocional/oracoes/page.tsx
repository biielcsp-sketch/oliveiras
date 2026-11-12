import { loadPrayers } from "@/lib/igreja/data";
import { todaySP } from "@/lib/financas/today";
import { PrayersView } from "../../_components/prayers-view";

export const metadata = { title: "Orações · Igreja" };

export default async function Page() {
  return <PrayersView items={await loadPrayers()} today={todaySP()} />;
}
