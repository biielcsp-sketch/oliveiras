import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { parseMonth } from "@/lib/financas/period";
import { formatBRL } from "@/lib/financas/money";
import { getMonthSummary } from "@/lib/financas/month-summary";
import { todaySP } from "@/lib/financas/today";
import { addDays } from "@/lib/agenda/dates";
import { firstName } from "@/lib/format";
import { agendaEnabled, getEventsBetween } from "@/lib/google/agenda";
import { APPOINTMENT_COLS, type HealthAppointment } from "@/lib/saude/types";
import { getCasaResumo } from "@/lib/casa/resumo";
import { getIgrejaResumo } from "@/lib/igreja/resumo";
import { initialHomeIndex, nextAgendaEvents, nextHealthItems } from "@/lib/home-panels";
import { HeadBar } from "@/components/head-bar";
import { HeroBackground } from "@/components/hero-background";
import { HomeArc } from "@/components/home-arc";
import { HomeCenterProvider, HomePanels } from "@/components/home-center";
import { MonthBalance } from "@/components/month-balance";
import { EmptyState, LinkButton } from "@/components/ui";
import { MonthSwitcher } from "../financas/_components/month-switcher";
import { CasaResumoTiles } from "../casa/_components/resumo-tiles";
import { IgrejaResumoTiles } from "../ministerio/_components/resumo-tiles";

export const metadata = { title: "Início" };

/** Lista curta do painel (Saúde e Agenda): quando, o quê e de quem. */
function ShortList({ items, empty, testId }: { items: { id: string; when: string; title: string; who: string }[]; empty: string; testId: string }) {
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <ul className="glass-card flex flex-col divide-y divide-line rounded-[20px] px-4" data-testid={testId}>
      {items.map((i) => (
        <li key={i.id} className="flex min-h-[60px] flex-col justify-center py-2.5">
          <p className="truncate text-[15px] font-semibold">{i.title}</p>
          <p className="truncate text-[13px] text-muted">
            {i.when}
            {i.who ? ` · ${i.who}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Início: painel da família. Cabeçalho azul com atalhos e o arco dos módulos; abaixo, o resumo do item que está no
 * centro do arco (troca sozinho ao deslizar). Os 5 resumos são lidos aqui em paralelo, com a sessão do usuário (RLS).
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await getAppContext();
  const sp = await searchParams;
  const name = firstName(ctx.me?.name);
  const month = parseMonth(sp.mes);
  const today = todaySP();
  const db = await createClient();
  const hh = ctx.household.id;
  const agendaOn = agendaEnabled(hh);
  const [summary, appts, exams, events, casa, igreja] = await Promise.all([
    getMonthSummary(month),
    db.from("health_appointments").select(APPOINTMENT_COLS).eq("household_id", hh).eq("status", "agendada").limit(1000),
    db.from("health_exams").select("id, member_id, name, exam_date").eq("household_id", hh).gte("exam_date", today).limit(200),
    agendaOn ? getEventsBetween(ctx, today, addDays(today, 6)) : Promise.resolve([]),
    getCasaResumo(),
    getIgrejaResumo(),
  ]);
  const nameOf = new Map(ctx.members.map((m) => [m.id, m.name]));
  const health = nextHealthItems((appts.data ?? []) as HealthAppointment[], exams.data ?? [], (id) => nameOf.get(id) ?? "", today);
  const agenda = nextAgendaEvents(events, today);

  return (
    <HomeCenterProvider initial={initialHomeIndex(Boolean(sp.mes))}>
      <div className="flex flex-col gap-3.5">
        <header className="relative -mx-4 -mt-[calc(env(safe-area-inset-top)+12px)] h-[calc(350px+env(safe-area-inset-top))] overflow-hidden text-white md:mx-0 md:mt-0 md:h-[350px] md:rounded-[32px]">
          <HeroBackground />
          <div className="absolute inset-x-0 bottom-0 h-[350px]">
            <HeadBar className="absolute inset-x-3 top-[14px]" />
            <div className="absolute left-[22px] right-4 top-[78px] md:top-[30px]">
              <h1 className="text-[26px] font-semibold tracking-tight">{name ? `Olá, ${name}!` : "Olá!"}</h1>
              <p className="mt-1 text-[14px] opacity-90">Que Deus abençoe seu dia! 🙏</p>
            </div>
            <HomeArc className="absolute inset-x-4 top-[146px] md:inset-x-0" />
          </div>
        </header>

        <HomePanels
          panels={{
            financas: (
              <>
                <MonthSwitcher month={month} basePath="/inicio" />
                {summary.hasAccounts ? (
                  <MonthBalance result={formatBRL(summary.result)} income={formatBRL(summary.income)} expense={formatBRL(-summary.expense)} />
                ) : (
                  <div className="glass-card rounded-[20px] p-[18px]">
                    <p className="text-[15px] font-semibold">Saldo do mês</p>
                    <p className="mt-1 text-sm text-muted">Cadastre uma conta nas Finanças para ver aqui o saldo, as entradas e as saídas do mês.</p>
                    <LinkButton href="/financas" size="sm" className="mt-3">
                      Abrir Finanças
                    </LinkButton>
                  </div>
                )}
              </>
            ),
            saude: (
              <ShortList
                testId="inicio-saude"
                empty="Nenhuma consulta ou exame marcado."
                items={health.map((h) => ({ id: h.id, when: h.when, title: h.title, who: h.person }))}
              />
            ),
            agenda: agendaOn ? (
              <ShortList testId="inicio-agenda" empty="Nenhum evento nos próximos dias." items={agenda.map((e) => ({ id: e.id, when: e.when, title: e.title, who: e.owner }))} />
            ) : (
              <EmptyState title="A Agenda ainda não está liberada para esta família." />
            ),
            casa: <CasaResumoTiles tiles={casa} only={["compras", "pet", "tarefas", "contas"]} />,
            ministerio: <IgrejaResumoTiles tiles={igreja} />,
          }}
        />
      </div>
    </HomeCenterProvider>
  );
}
