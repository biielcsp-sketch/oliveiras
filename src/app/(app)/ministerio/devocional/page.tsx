import { loadWords } from "@/lib/igreja/data";
import { todaySP } from "@/lib/financas/today";
import { WordsView } from "../_components/words-view";

export const metadata = { title: "Anotações · Igreja" };

export default async function Page() {
  return <WordsView kind="anotacao" items={await loadWords("anotacao")} today={todaySP()} />;
}
