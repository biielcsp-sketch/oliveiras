import Link from "next/link";
import { getAppContext } from "@/lib/data";
import { HOME_MODULES } from "@/lib/modules";
import { parseMonth } from "@/lib/financas/period";
import { formatBRL } from "@/lib/financas/money";
import { getMonthSummary } from "@/lib/financas/month-summary";
import { firstName } from "@/lib/format";
import { HeadBar } from "@/components/head-bar";
import { MonthBalance } from "@/components/month-balance";
import { LinkButton } from "@/components/ui";
import { MonthSwitcher } from "../financas/_components/month-switcher";

export const metadata = { title: "Início" };

/** Cabeçalho azul em onda, suave (só decoração; o conteúdo fica por cima). A onda fica abaixo dos rótulos do arco. */
function Wave() {
  return (
    <svg aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[350px] w-full" viewBox="0 0 390 350" preserveAspectRatio="none">
      <defs>
        <linearGradient id="inicio-hb" x1="0" y1="0" x2=".2" y2="1">
          <stop offset="0" stopColor="#0A44A8" />
          <stop offset="1" stopColor="#2A6BD0" />
        </linearGradient>
        <radialGradient id="inicio-g1" cx=".9" cy=".25" r=".55">
          <stop offset="0" stopColor="#9CC4FF" stopOpacity=".22" />
          <stop offset="1" stopColor="#9CC4FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M0 0H390V326C340 320 300 338 250 340C200 342 170 328 120 330C70 332 40 342 0 336Z" fill="url(#inicio-hb)" />
      <path d="M0 0H390V326C340 320 300 338 250 340C200 342 170 328 120 330C70 332 40 342 0 336Z" fill="url(#inicio-g1)" />
      {/* Trilho fino do arco, passando pelo centro das bolhas */}
      <path d="M0 236Q195 172 390 236" fill="none" stroke="#ffffff" strokeOpacity=".28" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Início: painel da família (cabeçalho azul com atalhos e módulos, seletor de mês e saldo do mês). */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { me } = await getAppContext();
  const name = firstName(me?.name);
  const month = parseMonth((await searchParams).mes);
  const summary = await getMonthSummary(month);

  return (
    <div className="flex flex-col gap-3.5">
      <header className="relative -mx-4 -mt-[calc(env(safe-area-inset-top)+12px)] h-[calc(350px+env(safe-area-inset-top))] overflow-hidden text-white md:mx-0 md:mt-0 md:h-[350px] md:rounded-[32px]">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[env(safe-area-inset-top)] bg-[#0A44A8]" />
        <Wave />
        <div className="absolute inset-x-0 bottom-0 h-[350px]">
          <HeadBar className="absolute inset-x-3 top-[14px]" />
          <div className="absolute left-[22px] right-4 top-[78px] md:top-[30px]">
            <h1 className="text-[26px] font-semibold tracking-tight">{name ? `Olá, ${name}!` : "Olá!"}</h1>
            <p className="mt-1 text-[14px] opacity-90">Que Deus abençoe seu dia! 🙏</p>
          </div>
          <nav aria-label="Módulos" className="absolute inset-x-2 top-[178px] mx-auto flex max-w-[560px] justify-between">
            {HOME_MODULES.map((m, i) => {
              const Icon = m.icon;
              // Arco: as pontas descem mais, as vizinhas um pouco
              const dist = Math.abs(i - (HOME_MODULES.length - 1) / 2);
              const drop = dist >= 2 ? "translate-y-[20px]" : dist >= 1 ? "translate-y-[6px]" : "";
              return (
                <Link
                  key={m.href}
                  href={m.entry ?? m.href}
                  className={`text-on-image flex w-[70px] flex-col items-center gap-1.5 text-[12.5px] font-medium text-white ${drop}`}
                >
                  <span className="glass-orb grid size-[50px] place-items-center rounded-full">
                    <Icon size={21} strokeWidth={1.7} aria-hidden />
                  </span>
                  {m.label}
                </Link>
              );
            })}
          </nav>
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
