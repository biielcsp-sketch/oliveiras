import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { isLabCategory } from "@/lib/saude/labs/catalog";
import { loadLabReports, loadLabResults } from "@/lib/saude/labs/data";
import { resolvePerson } from "@/lib/saude/labs/people";
import { buildEvolution, indexByMember, monthYearShort } from "@/lib/saude/labs/summary";
import { EmptyState, LinkButton } from "@/components/ui";
import { EvolutionTable } from "../_components/labs/evolution-table";
import { LabTop, PersonChips } from "../_components/labs/lab-ui";
import { ReportsList } from "../_components/labs/reports-list";

export const metadata = { title: "Evolução laboratorial · Saúde" };

export default async function Page({ searchParams }: { searchParams: Promise<{ pessoa?: string; categoria?: string }> }) {
  const sp = await searchParams;
  const ctx = await getAppContext();
  const db = await createClient();
  const reports = await loadLabReports(db, ctx.household.id);
  const index = indexByMember(reports, []);
  const people = ctx.members.filter((m) => index.has(m.id)).map((m) => ({ id: m.id, name: m.name }));
  const selected = resolvePerson(sp.pessoa, people, ctx.me?.id ?? null, false);

  if (!selected) {
    return (
      <div className="flex flex-col gap-3">
        <LabTop title="Evolução laboratorial" back={{ href: "/saude", label: "Resumo" }} />
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

  const mine = reports.filter((r) => r.member_id === selected);
  const results = await loadLabResults(db, ctx.household.id, { memberId: selected, reportIds: mine.map((r) => r.id) });
  const ev = buildEvolution(reports, results, selected);
  const categoria = isLabCategory(sp.categoria) ? sp.categoria : null;
  const rows = ev.rows.filter((r) => !categoria || r.category === categoria);
  const query = `?pessoa=${selected}`;
  const list = [...mine].sort((a, b) => b.collected_on.localeCompare(a.collected_on));

  return (
    <div className="flex flex-col gap-3">
      <LabTop title="Evolução laboratorial" back={{ href: `/saude${query}`, label: "Resumo" }} note={`${ev.totalReports} ${ev.totalReports === 1 ? "coleta" : "coletas"}`} />
      <PersonChips people={people} selected={selected} base="/saude/evolucao" allowAll={false} extra={categoria ? { categoria } : undefined} />
      <EvolutionTable
        columns={ev.columns.map((c) => monthYearShort(c.date))}
        rows={rows.map((r) => ({ key: r.key, name: r.name, unit: r.unit, cells: r.cells, status: r.status, trend: r.trend?.dir ?? null, move: r.move }))}
        query={query}
      />
      <p className="text-[11.5px] text-muted">
        Cor do valor: <b className="text-success">dentro</b> · <b className="text-warning">atenção</b> · <b className="text-danger">fora</b> da faixa de referência do laboratório. Toque num exame para ver o gráfico.
      </p>
      <ReportsList reports={list.map((r) => ({ id: r.id, date: r.collected_on, lab: r.lab, mime: r.file_mime, size: r.file_size }))} />
    </div>
  );
}
