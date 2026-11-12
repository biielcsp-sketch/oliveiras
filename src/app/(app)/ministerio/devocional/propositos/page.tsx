import { loadPurposes } from "@/lib/igreja/data";
import { PurposesView } from "../../_components/purposes-view";

export const metadata = { title: "Propósitos · Igreja" };

export default async function Page() {
  return <PurposesView items={await loadPurposes()} />;
}
