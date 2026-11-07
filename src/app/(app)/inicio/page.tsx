import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { ASSISTANT, MODULES } from "@/lib/modules";
import { Card } from "@/components/ui";

export const metadata = { title: "Início" };

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    ),
  );
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
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
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">{todayLabel}</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">
          {greeting()}, {firstName}.
        </h1>
      </header>

      <Link href={ASSISTANT.href}>
        <Card className="flex items-center gap-4 bg-olive-soft border-transparent transition hover:opacity-90">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-olive text-bg">
            <ASSISTANT.icon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Como está a vida da família?</p>
            <p className="truncate text-sm text-muted">O assistente vai responder aqui com o resumo da semana.</p>
          </div>
          <ChevronRight size={18} className="text-muted" />
        </Card>
      </Link>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {MODULES.map(({ href, label, icon: Icon, description }) => (
          <Link key={href} href={href}>
            <Card className="flex h-full flex-col gap-3 p-4 transition hover:bg-surface-2">
              <Icon size={22} strokeWidth={1.8} className="text-olive" />
              <div>
                <p className="font-medium">{label}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
