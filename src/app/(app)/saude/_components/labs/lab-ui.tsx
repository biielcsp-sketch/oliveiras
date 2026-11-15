import Link from "next/link";
import clsx from "clsx";
import { Activity, ArrowDown, ArrowLeft, ArrowUp, Bean, Droplet, FlaskConical, HeartPulse, Flame, LocateFixed, Minus, Pill, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui";
import type { LabCategory } from "@/lib/saude/labs/catalog";
import { STATUS_LABEL, type LabStatus } from "@/lib/saude/labs/status";
import type { PersonOption } from "@/lib/saude/labs/people";

export const STATUS_TONE = { dentro: "success", atencao: "warning", fora: "danger", sem_faixa: "neutral" } as const;
export const STATUS_TEXT: Record<LabStatus, string> = { dentro: "text-success", atencao: "text-warning", fora: "text-danger", sem_faixa: "text-ink" };

export const CATEGORY_ICON: Record<LabCategory, LucideIcon> = {
  cardiovascular: HeartPulse,
  metabolismo: Flame,
  rins: Bean,
  sangue: Droplet,
  tireoide: Zap,
  imunidade: ShieldCheck,
  vitaminas_minerais: Pill,
  hormonios: LocateFixed,
  figado: Activity,
  urina: FlaskConical,
  outros: Activity,
};

export function StatusBadge({ status }: { status: LabStatus | null }) {
  const s = status ?? "sem_faixa";
  return <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>;
}

/** Topo das telas de exames: voltar para a tela de cima + nota à direita, e o título. */
export function LabTop({ title, back, note }: { title: string; back?: { href: string; label: string }; note?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center justify-between gap-3">
        {back ? (
          <Link href={back.href} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-[15px] font-medium text-link">
            <ArrowLeft size={18} aria-hidden />
            {back.label}
          </Link>
        ) : (
          <span />
        )}
        {note && <span className="text-[12px] text-muted">{note}</span>}
      </div>
      <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
    </header>
  );
}

/** Filtro por pessoa (links com ?pessoa=). Só aparece com mais de uma pessoa com exames. */
export function PersonChips({ people, selected, base, allowAll, extra }: { people: PersonOption[]; selected: string | null; base: string; allowAll: boolean; extra?: Record<string, string> }) {
  if (people.length < 2) return null;
  const href = (id: string | null) => {
    const q = new URLSearchParams(extra);
    if (id) q.set("pessoa", id);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const chip = (active: boolean) =>
    clsx("inline-flex h-[34px] items-center whitespace-nowrap rounded-full px-3.5 text-[13px] transition", active ? "bg-accent-soft font-semibold text-deep shadow-soft" : "glass-card font-medium text-ink hover:text-primary");
  return (
    <nav aria-label="Filtrar por pessoa" className="flex flex-wrap gap-2">
      {allowAll && (
        <Link href={href(null)} className={chip(selected === null)} aria-current={selected === null ? "true" : undefined}>
          Todos
        </Link>
      )}
      {people.map((p) => (
        <Link key={p.id} href={href(p.id)} className={chip(selected === p.id)} aria-current={selected === p.id ? "true" : undefined}>
          {p.name}
        </Link>
      ))}
    </nav>
  );
}

/** Seta de tendência: o sentido é o do valor; a cor diz se melhorou (verde), piorou (vermelho) ou nada (neutra). */
export function TrendIcon({ dir, move, label }: { dir: "melhorou" | "piorou" | "estavel" | "subiu" | "caiu" | null; move: "up" | "down" | "same" | null; label: string }) {
  if (!dir || !move) return <span aria-hidden />;
  const tone = dir === "melhorou" ? "text-success" : dir === "piorou" ? "text-danger" : "text-muted";
  const Icon = move === "up" ? ArrowUp : move === "down" ? ArrowDown : Minus;
  return (
    <span className={clsx("grid place-items-center", tone)} aria-label={label} role="img">
      <Icon size={17} strokeWidth={2.2} aria-hidden />
    </span>
  );
}
