import { getAppContext } from "@/lib/data";
import { greetingFor } from "@/lib/format";
import { OliHome } from "@/components/oli/oli-home";

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
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-muted">{todayLabel}</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">
          {greeting()}, {firstName}.
        </h1>
      </header>
      <OliHome />
    </div>
  );
}
