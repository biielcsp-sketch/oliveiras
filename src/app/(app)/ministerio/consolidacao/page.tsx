import { CalendarClock, HeartHandshake, Users, type LucideIcon } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Consolidação · Igreja" };

const SECTIONS: { key: string; title: string; detail: string; icon: LucideIcon }[] = [
  { key: "escala", title: "Escala", detail: "Sua escala de serviço na Consolidação.", icon: CalendarClock },
  { key: "reunioes", title: "Reuniões", detail: "Reuniões e encontros da equipe.", icon: Users },
  { key: "pessoas", title: "Pessoas acompanhadas", detail: "Quem você está acompanhando e o follow-up.", icon: HeartHandshake },
];

/** Só a tela, por decisão do dono: nada é gravado e não há chamada externa até a integração existir. */
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <Card tone="hero" role="note">
        <p className="text-lg font-semibold">Integração com o app da Consolidação em breve</p>
        <p className="mt-1 text-sm opacity-90">Escala, reuniões e pessoas acompanhadas vão aparecer aqui quando o app da Consolidação estiver ligado ao Oliveira&apos;s.</p>
      </Card>
      {SECTIONS.map(({ key, title, detail, icon: Icon }) => (
        <section key={key} aria-label={title} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Icon size={20} aria-hidden className="text-primary" /> {title}
          </h2>
          <EmptyState title={`Nada em ${title.toLowerCase()} por enquanto.`}>
            {detail} Integração com o app da Consolidação em breve.
          </EmptyState>
        </section>
      ))}
    </div>
  );
}
