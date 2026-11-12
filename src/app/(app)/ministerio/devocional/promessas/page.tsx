import { loadWords } from "@/lib/igreja/data";
import { todaySP } from "@/lib/financas/today";
import { WordsView } from "../../_components/words-view";

export const metadata = { title: "Promessas · Igreja" };

export default async function Page() {
  return <WordsView kind="promessa" items={await loadWords("promessa")} today={todaySP()} />;
}
