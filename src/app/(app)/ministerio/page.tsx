import Link from "next/link";
import { BookHeart, GraduationCap, HandHeart, Target, Users, type LucideIcon } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { brDate } from "@/lib/agenda/dates";
import { todaySP } from "@/lib/financas/today";
import { ModuleHeroCard } from "@/components/module-home";

export const metadata = { title: "Igreja" };

function Tile({ href, icon: Icon, title, lines, testId }: { href: string; icon: LucideIcon; title: string; lines: string[]; testId: string }) {
  // min-w-0: sem ele o item da grade cresce até a largura do texto com truncate e a página rola para os lados
  return (
    <Link href={href} className="block min-w-0" data-testid={testId}>
      <div className="glass-card flex h-full items-start gap-3.5 rounded-[20px] px-4 py-3.5 transition hover:brightness-105">
        <span className="tic size-[42px]">
          <Icon size={20} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight">{title}</p>
          {lines.map((l) => (
            <p key={l} className="truncate text-[13px] text-muted">
              {l}
            </p>
          ))}
        </div>
      </div>
    </Link>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Resumo da Igreja: só os itens do próprio usuário (dados pessoais). */
export default async function Page() {
  const ctx = await getAppContext();
  const db = await createClient();
  const hh = ctx.household.id;
  const me = ctx.user.id;
  const today = todaySP();
  const [prayers, purposes, lastWord, promises, nextLesson, lastLesson] = await Promise.all([
    db.from("igreja_prayers").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("owner_id", me).eq("status", "orando"),
    db.from("igreja_purposes").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("owner_id", me).eq("status", "em_andamento"),
    db.from("igreja_words").select("title, body, received_on").eq("household_id", hh).eq("owner_id", me).eq("kind", "anotacao").order("received_on", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("igreja_words").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("owner_id", me).eq("kind", "promessa").is("fulfilled_on", null),
    db.from("igreja_carisma_lessons").select("title, lesson_date").eq("household_id", hh).eq("owner_id", me).gte("lesson_date", today).order("lesson_date").limit(1).maybeSingle(),
    db.from("igreja_carisma_lessons").select("title, lesson_date").eq("household_id", hh).eq("owner_id", me).lt("lesson_date", today).order("lesson_date", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const word = lastWord.data as { title: string | null; body: string; received_on: string } | null;
  const next = nextLesson.data as { title: string; lesson_date: string } | null;
  const last = lastLesson.data as { title: string; lesson_date: string } | null;
  const preview = (s: string) => (s.length > 70 ? `${s.slice(0, 69)}…` : s);

  return (
    <div className="flex flex-col gap-6">
      <ModuleHeroCard title="Conecte-se com a sua igreja" subtitle="Faça parte desta família." image="/ilustracoes/igreja.webp" />
      <section aria-labelledby="resumo-titulo" className="min-w-0">
        <h2 id="resumo-titulo" className="mb-2 text-[15.5px] font-bold tracking-tight">
          Resumo
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
      <Tile
        href="/ministerio/devocional/oracoes"
        icon={HandHeart}
        title="Orações"
        testId="igreja-resumo-oracoes"
        lines={[prayers.count ? `${plural(prayers.count, "oração", "orações")} em andamento` : "Nenhuma oração em andamento"]}
      />
      <Tile
        href="/ministerio/devocional/propositos"
        icon={Target}
        title="Propósitos"
        testId="igreja-resumo-propositos"
        lines={[purposes.count ? `${plural(purposes.count, "propósito", "propósitos")} em andamento` : "Nenhum propósito em andamento"]}
      />
      <Tile
        href="/ministerio/devocional"
        icon={BookHeart}
        title="Última anotação"
        testId="igreja-resumo-anotacao"
        lines={[
          word ? `${brDate(word.received_on)} · ${preview(word.title ?? word.body.replace(/\s+/g, " "))}` : "Nenhuma anotação ainda",
          promises.count ? `${plural(promises.count, "promessa aguardando", "promessas aguardando")} o cumprimento` : "",
        ].filter(Boolean)}
      />
      <Tile
        href="/ministerio/carisma"
        icon={GraduationCap}
        title="Carisma"
        testId="igreja-resumo-carisma"
        lines={[
          next ? `Próxima aula: ${brDate(next.lesson_date)} · ${next.title}` : "",
          last ? `Última aula: ${brDate(last.lesson_date)} · ${last.title}` : "",
        ].filter(Boolean).concat(!next && !last ? ["Nenhuma aula com data ainda"] : [])}
      />
      <Tile href="/ministerio/consolidacao" icon={Users} title="Consolidação" testId="igreja-resumo-consolidacao" lines={["Integração com o app da Consolidação em breve"]} />
        </div>
      </section>
    </div>
  );
}
