import { getAppContext } from "@/lib/data";
import { parseMonth } from "@/lib/financas/period";
import { formatBRL } from "@/lib/financas/money";
import { getMonthSummary } from "@/lib/financas/month-summary";
import { firstName } from "@/lib/format";
import { HeadBar } from "@/components/head-bar";
import { HeroBackground } from "@/components/hero-background";
import { HomeArc } from "@/components/home-arc";
import { MonthBalance } from "@/components/month-balance";
import { LinkButton } from "@/components/ui";
import { MonthSwitcher } from "../financas/_components/month-switcher";

export const metadata = { title: "Início" };

/** Início: painel da família (cabeçalho azul com atalhos e módulos, seletor de mês e saldo do mês). */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { me } = await getAppContext();
  const name = firstName(me?.name);
  const month = parseMonth((await searchParams).mes);
  const summary = await getMonthSummary(month);

  return (
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
    </div>
  );
}
