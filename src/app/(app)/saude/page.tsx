import Link from "next/link";
import { ChevronRight, FileUp, ListChecks, TrendingUp } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { brDate } from "@/lib/agenda/dates";
import { loadLabReports, loadLabResults } from "@/lib/saude/labs/data";
import { resolvePerson } from "@/lib/saude/labs/people";
import { buildSummary, indexByMember } from "@/lib/saude/labs/summary";
import { Card, EmptyState, IconCircle, LinkButton } from "@/components/ui";
import { CATEGORY_ICON, LabTop, PersonChips, StatusBadge } from "./_components/labs/lab-ui";

export const metadata = { title: "Resumo de saúde" };

/** Raiz da Saúde: % dentro do padrão do último relatório de cada pessoa e as categorias. */
export default async function Page({ searchParams }: { searchParams: Promise<{ pessoa?: string }> }) {
  const sp = await searchParams;
  const ctx = await getAppContext();
  const db = await createClient();
  const reports = await loadLabReports(db, ctx.household.id);

  if (reports.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <LabTop title="Resumo de saúde" />
        <EmptyState title="Nenhum exame de laboratório ainda.">
          <p>Envie o PDF do laudo e o Oli lê os resultados para você conferir.</p>
          <div className="mt-4 flex justify-center">
            <LinkButton href="/saude/exames-lab/enviar" size="md">
              <FileUp size={16} aria-hidden /> Enviar exames
            </LinkButton>
          </div>
        </EmptyState>
      </div>
    );
  }

  const index = indexByMember(reports, []);
  const people = ctx.members.filter((m) => index.has(m.id)).map((m) => ({ id: m.id, name: m.name }));
  const selected = resolvePerson(sp.pessoa, people, ctx.me?.id ?? null, true);
  // Só o último relatório de cada pessoa entra no resumo.
  const latestIds = [...index.entries()].filter(([id]) => !selected || id === selected).map(([, m]) => m.reports[m.reports.length - 1].id);
  const results = await loadLabResults(db, ctx.household.id, { reportIds: latestIds });
  const sm = buildSummary(reports, results, selected);
  const q = selected ? `?pessoa=${selected}` : "";
  const pending = sm.counts.atencao + sm.counts.fora;
  const pct = sm.scorePct ?? 0;
  const C = 2 * Math.PI * 34;
  const title = people.length > 1 && !selected ? "Exames da família" : "Seus principais exames";

  return (
    <div className="flex flex-col gap-3">
      <LabTop title="Resumo de saúde" note={sm.collectedOn ? `Coleta de ${brDate(sm.collectedOn)}` : undefined} />
      <PersonChips people={people} selected={selected} base="/saude" allowAll />
      <Card tone="hero" className="flex items-center justify-between gap-3 !px-[18px] !py-4" data-testid="saude-hero">
        <div>
          <p className="text-[12px] opacity-85">{title}</p>
          <p className="mt-0.5 text-[19px] font-semibold">{sm.counts.analisados} analisados</p>
          <p className="mt-1.5 text-[12.5px] opacity-90">
            {sm.counts.dentro} dentro do padrão · {pending} pedem atenção
          </p>
        </div>
        <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={sm.scorePct === null ? "Sem resultados com faixa de referência" : `${pct}% dos exames dentro do padrão`}>
          <circle cx="42" cy="42" r="34" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="8" />
          <circle cx="42" cy="42" r="34" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 42 42)" />
          <text x="42" y="48" textAnchor="middle" fontSize="19" fontWeight="600" fill="#fff">
            {sm.scorePct === null ? "–" : `${pct}%`}
          </text>
        </svg>
      </Card>

      <ul className="grid grid-cols-2 gap-2.5" aria-label="Categorias de exames">
        {sm.categories.map((c) => {
          const Icon = CATEGORY_ICON[c.category];
          return (
            <li key={c.category}>
              <Link
                href={`/saude/evolucao?categoria=${c.category}${selected ? `&pessoa=${selected}` : ""}`}
                data-testid="saude-categoria"
                className="glass-card flex h-[104px] flex-col gap-1.5 rounded-[20px] p-3 transition hover:brightness-105"
              >
                <span className="flex items-center justify-between">
                  <IconCircle size={34}>
                    <Icon size={18} />
                  </IconCircle>
                  <ChevronRight size={16} className="text-muted" aria-hidden />
                </span>
                <b className="text-[14px] font-semibold leading-tight">{c.label}</b>
                <span className="flex">
                  <StatusBadge status={c.status} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link href={`/saude/evolucao${q}`} className="glass-card flex items-center gap-2.5 rounded-[20px] px-3.5 py-3">
        <TrendingUp size={20} className="text-primary" aria-hidden />
        <span className="flex-1">
          <b className="block text-[14px] font-semibold">Evolução laboratorial</b>
          <span className="text-[12px] text-muted">Compare suas coletas e veja os gráficos</span>
        </span>
        <ChevronRight size={16} className="text-muted" aria-hidden />
      </Link>
      <Link href={`/saude/orientacoes${q}`} className="glass-card flex items-center gap-2.5 rounded-[20px] px-3.5 py-3">
        <ListChecks size={20} className="text-primary" aria-hidden />
        <span className="flex-1">
          <b className="block text-[14px] font-semibold">Orientações</b>
          <span className="text-[12px] text-muted">Pontos para melhorar e o que vai bem</span>
        </span>
        <ChevronRight size={16} className="text-muted" aria-hidden />
      </Link>
      <Link href="/saude/exames-lab/enviar" className="glass-card flex items-center gap-2.5 rounded-[20px] px-3.5 py-3">
        <FileUp size={20} className="text-primary" aria-hidden />
        <span className="flex-1">
          <b className="block text-[14px] font-semibold">Enviar exames</b>
          <span className="text-[12px] text-muted">Mande o PDF do laudo e confira os resultados</span>
        </span>
        <ChevronRight size={16} className="text-muted" aria-hidden />
      </Link>
    </div>
  );
}
