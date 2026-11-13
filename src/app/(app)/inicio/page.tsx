import Link from "next/link";
import { CalendarDays, Users } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { HOME_MODULES } from "@/lib/modules";
import { parseMonth } from "@/lib/financas/period";
import { formatBRL } from "@/lib/financas/money";
import { getMonthSummary } from "@/lib/financas/month-summary";
import { firstName } from "@/lib/format";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AgendaCalendarButton } from "@/components/agenda-calendar";
import { MonthBalance } from "@/components/month-balance";
import { LinkButton } from "@/components/ui";
import { MonthSwitcher } from "../financas/_components/month-switcher";

export const metadata = { title: "Início" };

const headBtn = "glass-clear grid size-11 place-items-center rounded-full transition hover:brightness-110 active:scale-95";

/** Cabeçalho azul em onda com o arco de vidro (só decoração; o conteúdo fica por cima). */
function Wave() {
  return (
    <svg aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[330px] w-full" viewBox="0 0 390 330" preserveAspectRatio="none">
      <defs>
        <linearGradient id="inicio-hb" x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor="#05379A" />
          <stop offset=".6" stopColor="#0A47AE" />
          <stop offset="1" stopColor="#1A5CC4" />
        </linearGradient>
        <radialGradient id="inicio-g1" cx=".95" cy=".35" r=".45">
          <stop offset="0" stopColor="#7FB2FF" stopOpacity=".45" />
          <stop offset="1" stopColor="#7FB2FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="inicio-arc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity=".04" />
        </linearGradient>
        <filter id="inicio-blur4">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="inicio-blur18">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <path d="M0 0H390V292C330 286 300 310 250 312C200 314 170 296 120 298C70 300 40 316 0 306Z" fill="url(#inicio-hb)" />
      <path d="M0 0H390V292C330 286 300 310 250 312C200 314 170 296 120 298C70 300 40 316 0 306Z" fill="url(#inicio-g1)" />
      <path d="M0 238C80 176 310 176 390 238V292C330 286 300 310 250 312C200 314 170 296 120 298C70 300 40 316 0 306Z" fill="url(#inicio-arc)" />
      <path d="M0 238C80 176 310 176 390 238" fill="none" stroke="#ffffff" strokeOpacity=".7" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <path d="M30 226C110 184 280 184 360 226" fill="none" stroke="#BFE0FF" strokeOpacity=".35" strokeWidth="6" filter="url(#inicio-blur4)" />
      <circle cx="350" cy="120" r="70" fill="#8EC2FF" opacity=".22" filter="url(#inicio-blur18)" />
      <circle cx="40" cy="40" r="60" fill="#3E7FE0" opacity=".35" filter="url(#inicio-blur18)" />
      <circle cx="300" cy="200" r="2" fill="#fff" opacity=".9" />
      <circle cx="90" cy="214" r="1.6" fill="#fff" opacity=".8" />
      <circle cx="205" cy="160" r="1.4" fill="#fff" opacity=".7" />
      <circle cx="340" cy="60" r="1.5" fill="#fff" opacity=".8" />
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
      <header className="relative -mx-4 -mt-[calc(env(safe-area-inset-top)+12px)] h-[calc(330px+env(safe-area-inset-top))] overflow-hidden text-white md:mx-0 md:mt-0 md:h-[330px] md:rounded-[32px]">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[env(safe-area-inset-top)] bg-[#05379A]" />
        <Wave />
        <div className="absolute inset-x-0 bottom-0 h-[330px]">
          <div className="absolute left-5 right-4 top-[18px] flex items-center justify-between">
            <Link href="/inicio" aria-label="Oliveira's, ir para o Início" className="rounded-2xl text-white">
              <Logo inverted size={30} />
            </Link>
            <div className="flex gap-2">
              <ThemeToggle className={headBtn} />
              <AgendaCalendarButton className={headBtn}>
                <CalendarDays size={20} strokeWidth={1.8} aria-hidden />
              </AgendaCalendarButton>
              <Link href="/familia" aria-label="Família" className={headBtn}>
                <Users size={20} strokeWidth={1.8} aria-hidden />
              </Link>
            </div>
          </div>
          <div className="absolute left-[22px] right-4 top-[92px]">
            <h1 className="text-[27px] font-bold tracking-tight">{name ? `Olá, ${name}!` : "Olá!"}</h1>
            <p className="mt-1.5 text-[14.5px] opacity-95">Que Deus abençoe seu dia! 🙏</p>
          </div>
          <nav aria-label="Módulos" className="absolute inset-x-[10px] top-[200px] mx-auto flex max-w-[560px] justify-between">
            {HOME_MODULES.map((m, i) => {
              const Icon = m.icon;
              const outer = i === 0 || i === HOME_MODULES.length - 1;
              return (
                <Link
                  key={m.href}
                  href={m.entry ?? m.href}
                  className={`text-on-image flex w-[84px] flex-col items-center gap-[7px] text-[13px] font-semibold text-white ${outer ? "translate-y-[22px]" : ""}`}
                >
                  <span className="glass-orb grid size-[54px] place-items-center rounded-full">
                    <Icon size={23} strokeWidth={1.8} aria-hidden />
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
