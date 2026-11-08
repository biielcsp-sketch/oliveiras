import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { ASSISTANT, MODULES } from "@/lib/modules";
import { Card, SectionHeader, Tag } from "@/components/ui";
import { greetingFor } from "@/lib/format";

export const metadata = { title: "Início" };

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    ),
  );
  return greetingFor(h);
}

export default async function InicioPage() {
  const { me } = await getAppContext();
  const firstName = me?.name.split(" ")[0] ?? "";
  const today = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const todayLabel = today.charAt(0).toUpperCase() + today.slice(1);

  return (
    <div className="flex flex-col gap-9">
      <header>
        <p className="text-sm text-muted">{todayLabel}</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">
          {greeting()}, {firstName}.
        </h1>
      </header>

      <Link href={ASSISTANT.href} className="block rounded-[24px]">
        <Card tone="hero" className="relative flex flex-col gap-4 overflow-hidden transition hover:brightness-110">
          <div className="flex items-start justify-between">
            <span className="grid size-12 place-items-center rounded-full border border-white/25 text-on-primary">
              <ASSISTANT.icon size={22} aria-hidden />
            </span>
            <Tag tone="info">{ASSISTANT.label}</Tag>
          </div>
          <div>
            <p className="text-xl font-semibold leading-snug">Como está a vida da família?</p>
            <p className="mt-1 text-sm text-info">O assistente vai responder aqui com o resumo da semana.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[15px] font-medium">
            Conversar com o Oli <ChevronRight size={18} aria-hidden />
          </span>
        </Card>
      </Link>

      <section>
        <SectionHeader title="Áreas da família" count={MODULES.length} />
        <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3">
          {MODULES.map(({ href, label, icon: Icon, description, phase }) => (
            <li key={href}>
              <Link href={href} className="block h-full rounded-[24px]">
                <Card className="flex h-full flex-col gap-3 p-4 transition hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid size-11 place-items-center rounded-full border border-line bg-surface-solid text-primary">
                      <Icon size={20} strokeWidth={1.8} aria-hidden />
                    </span>
                    {phase && phase > 1 && <Tag>Fase {phase}</Tag>}
                  </div>
                  <div>
                    <p className="text-[17px] font-semibold tracking-tight">{label}</p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{description}</p>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
