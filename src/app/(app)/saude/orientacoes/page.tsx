import { AlertTriangle, CheckCircle2, TrendingUp, type LucideIcon } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { loadLabReports, loadLabResults } from "@/lib/saude/labs/data";
import { resolvePerson } from "@/lib/saude/labs/people";
import { buildOrientations, indexByMember, monthYear } from "@/lib/saude/labs/summary";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { LabTop, PersonChips } from "../_components/labs/lab-ui";

export const metadata = { title: "Orientações · Saúde" };

const GROUP: Record<string, { dot: string; icon: LucideIcon; tone: string }> = {
  melhorar: { dot: "bg-danger", icon: AlertTriangle, tone: "text-danger" },
  dentro: { dot: "bg-success", icon: CheckCircle2, tone: "text-success" },
  indo_bem: { dot: "bg-success", icon: TrendingUp, tone: "text-success" },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ pessoa?: string }> }) {
  const sp = await searchParams;
  const ctx = await getAppContext();
  const db = await createClient();
  const reports = await loadLabReports(db, ctx.household.id);
  const index = indexByMember(reports, []);
  const people = ctx.members.filter((m) => index.has(m.id)).map((m) => ({ id: m.id, name: m.name }));
  const selected = resolvePerson(sp.pessoa, people, ctx.me?.id ?? null, true);
  const query = selected ? `?pessoa=${selected}` : "";

  if (people.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <LabTop title="Orientações" back={{ href: "/saude", label: "Resumo" }} />
        <EmptyState title="Nenhum exame de laboratório ainda.">
          <div className="mt-3 flex justify-center">
            <LinkButton href="/saude/exames-lab/enviar" size="md">
              Enviar exames
            </LinkButton>
          </div>
        </EmptyState>
      </div>
    );
  }

  // Histórico completo: a tendência compara a coleta mais recente com a anterior.
  const scope = reports.filter((r) => !selected || r.member_id === selected);
  const results = await loadLabResults(db, ctx.household.id, { reportIds: scope.map((r) => r.id) });
  const o = buildOrientations(scope, results, selected, new Map(ctx.members.map((m) => [m.id, m.name])));

  return (
    <div className="flex flex-col gap-3">
      <LabTop title="Orientações" back={{ href: `/saude${query}`, label: "Resumo" }} note={o.collectedOn ? `Com base na coleta de ${monthYear(o.collectedOn)}` : undefined} />
      <PersonChips people={people} selected={selected} base="/saude/orientacoes" allowAll />
      {o.grupos.length === 0 && <EmptyState title="Sem orientações por enquanto.">Os exames enviados não trazem faixa de referência para comparar.</EmptyState>}
      {o.grupos.map((g) => {
        const s = GROUP[g.key];
        const Icon = s.icon;
        return (
          <Card key={g.key} data-testid={`orientacao-${g.key}`} className="!px-4 !pb-0.5 !pt-3">
            <div className="mb-1 flex items-center gap-2">
              <span className={`size-2 rounded-full ${s.dot}`} aria-hidden />
              <h3 className="text-[15px] font-semibold">{g.titulo}</h3>
            </div>
            <ul>
              {g.itens.map((i, n) => (
                <li key={n} className="flex gap-2.5 border-t border-line py-2.5">
                  <Icon size={18} className={`mt-0.5 shrink-0 ${s.tone}`} aria-hidden />
                  <div className="text-[13px] leading-snug">
                    <b className="font-semibold">{i.titulo}</b>
                    <span className="block text-muted">{i.texto}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      <p className="text-[11.5px] leading-snug text-muted" data-testid="orientacao-aviso">
        {o.aviso}
      </p>
    </div>
  );
}
