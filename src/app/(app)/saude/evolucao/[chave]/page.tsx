import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Lightbulb, Minus } from "lucide-react";
import clsx from "clsx";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { todaySP } from "@/lib/financas/today";
import { LAB_CATEGORY_LABEL } from "@/lib/saude/labs/catalog";
import { loadLabReports, loadLabResults } from "@/lib/saude/labs/data";
import { resolvePerson } from "@/lib/saude/labs/people";
import { buildSeries, indexByMember, isSeriesWindow, meaningText, monthYear, trendSentence, windowPoints, type SeriesWindow } from "@/lib/saude/labs/summary";
import { Card } from "@/components/ui";
import { OliSphere } from "@/components/oli/oli-sphere";
import { LabChart } from "../../_components/labs/lab-chart";
import { LabTop, PersonChips, StatusBadge, STATUS_TEXT } from "../../_components/labs/lab-ui";

export const metadata = { title: "Exame · Saúde" };

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WINDOWS: { key: SeriesWindow; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "1a", label: "1 ano" },
  { key: "6m", label: "6 meses" },
];

export default async function Page({ params, searchParams }: { params: Promise<{ chave: string }>; searchParams: Promise<{ pessoa?: string; janela?: string }> }) {
  const { chave } = await params;
  const sp = await searchParams;
  if (!KEY_RE.test(chave) || chave.length > 80) notFound();
  const ctx = await getAppContext();
  const db = await createClient();
  const reports = await loadLabReports(db, ctx.household.id);
  const index = indexByMember(reports, []);
  const people = ctx.members.filter((m) => index.has(m.id)).map((m) => ({ id: m.id, name: m.name }));
  const selected = resolvePerson(sp.pessoa, people, ctx.me?.id ?? null, false);
  if (!selected) notFound();
  const mine = reports.filter((r) => r.member_id === selected);
  const results = await loadLabResults(db, ctx.household.id, { memberId: selected, key: chave, reportIds: mine.map((r) => r.id) });
  const series = buildSeries(reports, results, selected, chave);
  if (!series || !series.latest) notFound();

  const janela: SeriesWindow = isSeriesWindow(sp.janela) ? sp.janela : "todas";
  const points = windowPoints(series.points, janela, todaySP());
  const l = series.latest;
  const sentence = trendSentence(series);
  const base = `/saude/evolucao/${chave}`;
  const q = (j: SeriesWindow) => `?pessoa=${selected}${j === "todas" ? "" : `&janela=${j}`}`;
  const TrendArrow = series.points.length >= 2 ? (series.points[series.points.length - 1].value > series.points[series.points.length - 2].value ? ArrowUp : series.points[series.points.length - 1].value < series.points[series.points.length - 2].value ? ArrowDown : Minus) : null;
  const tone = series.trend?.dir === "melhorou" ? "text-success" : series.trend?.dir === "piorou" ? "text-danger" : "text-muted";

  return (
    <div className="flex flex-col gap-3">
      <LabTop title={series.name} back={{ href: `/saude/evolucao?pessoa=${selected}`, label: "Evolução" }} note={LAB_CATEGORY_LABEL[series.category]} />
      <PersonChips people={people} selected={selected} base={base} allowAll={false} extra={janela === "todas" ? undefined : { janela }} />
      <Card className="flex items-center justify-between gap-3 !px-4 !py-3.5" data-testid="lab-ultimo">
        <div>
          <p className="text-[12px] text-muted">Último resultado · {monthYear(l.date)}</p>
          <p className={clsx("mt-0.5 text-[28px] font-semibold", STATUS_TEXT[l.status])}>
            {l.value} {series.unit && <span className="text-[13px] font-normal text-muted">{series.unit}</span>}
          </p>
          {l.range && <p className="text-[12px] text-muted">Faixa do laboratório: {l.range}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={l.status} />
          {sentence && (
            <span className={clsx("inline-flex items-center gap-1 text-[12.5px] font-medium", tone)}>
              {TrendArrow && <TrendArrow size={14} aria-hidden />}
              {sentence}
            </span>
          )}
        </div>
      </Card>

      <Card className="!px-2.5 !pb-1.5 !pt-3">
        {series.points.length > 0 ? (
          <>
            <div className="flex gap-1.5 px-1.5 pb-1.5" role="group" aria-label="Período do gráfico">
              {WINDOWS.map((w) => (
                <Link
                  key={w.key}
                  href={`${base}${q(w.key)}`}
                  aria-current={janela === w.key ? "true" : undefined}
                  className={clsx("relative inline-flex h-[30px] items-center whitespace-nowrap rounded-full px-3 text-[13px]", janela === w.key ? "bg-accent-soft font-semibold text-deep shadow-soft" : "glass-card font-medium text-ink")}
                >
                  <span aria-hidden className="absolute left-1/2 top-1/2 h-full min-h-11 w-full min-w-11 -translate-x-1/2 -translate-y-1/2" />
                  {w.label}
                </Link>
              ))}
            </div>
            <LabChart name={series.name} unit={series.unit} points={points} refMin={l.min} refMax={l.max} rangeText={l.range} />
          </>
        ) : (
          <p className="px-3 py-6 text-center text-[13px] text-muted">Este resultado não é numérico, então não há gráfico.</p>
        )}
      </Card>

      <Card className="flex gap-2.5 !px-4 !py-3">
        <Lightbulb size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <div>
          <b className="text-[14px] font-semibold">O que isso significa</b>
          <p className="mt-1 text-[13px] leading-normal text-muted" data-testid="lab-significado">
            {meaningText(series)}
          </p>
          <p className="mt-1 text-[11.5px] text-muted">Orientação geral, calculada a partir das faixas de referência do seu laboratório. Não substitui consulta médica.</p>
        </div>
      </Card>

      <Link href="/assistente" className="glass-card relative inline-flex h-11 items-center gap-2 self-start rounded-full px-4 text-[13.5px] font-medium text-deep">
        <OliSphere size={20} />
        Perguntar ao Oli sobre este exame
      </Link>
    </div>
  );
}
