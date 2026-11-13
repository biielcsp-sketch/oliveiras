import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, CircleAlert, Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** Card de vidro (radius 20). `tone="hero"`: card azul de destaque, texto branco. */
export function Card({ className, tone = "glass", ...props }: ComponentProps<"div"> & { tone?: "glass" | "hero" }) {
  return (
    <div
      className={clsx("rounded-[20px] p-5", tone === "glass" ? "glass-card" : "card-hero rounded-[22px]", className)}
      {...props}
    />
  );
}

export const btnBase =
  "relative inline-flex items-center justify-center gap-1.5 rounded-full text-center font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress";

export const btnVariant = {
  primary: "glass-primary hover:brightness-110",
  secondary: "border border-line bg-surface-solid text-deep hover:bg-accent-soft",
  ghost: "glass-card text-ink hover:brightness-105",
  danger: "text-danger hover:bg-danger-soft",
};

/**
 * Tamanhos visuais compactos (sm 34px, md 40px, lg 44px), largura do conteúdo.
 * A área de toque continua com pelo menos 44px pelo <TapArea> invisível dentro do botão.
 */
export const btnSize = {
  sm: "h-[34px] px-3.5 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-[18px] text-sm",
  /** só ícone: círculo de 44px sem padding lateral */
  icon: "size-11 shrink-0 p-0",
};

/**
 * Área de toque invisível de pelo menos 44x44px, centrada no botão (que precisa ser `relative`).
 * Deixa o botão visualmente menor sem perder o alvo mínimo de toque.
 */
export function TapArea() {
  return (
    <span
      aria-hidden
      data-tap-area
      className="absolute left-1/2 top-1/2 h-full min-h-11 w-full min-w-11 -translate-x-1/2 -translate-y-1/2"
    />
  );
}

type BtnVariant = keyof typeof btnVariant;
type BtnSize = keyof typeof btnSize;

export function Button({
  variant = "primary",
  size = "lg",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & { variant?: BtnVariant; size?: BtnSize; loading?: boolean }) {
  return (
    <button
      className={clsx(btnBase, btnSize[size], btnVariant[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <TapArea />
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const fieldBase =
  "w-full rounded-[14px] border border-line bg-surface-solid px-3.5 text-[15px] text-ink outline-none transition placeholder:text-muted focus:border-primary focus:ring-[3px] focus:ring-primary/15 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-[3px] aria-[invalid=true]:ring-danger/15 disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(fieldBase, "h-11", className)} {...props} />;
}

/** Rótulo + campo. `error`: mensagem em vermelho com ícone (não depende só da cor). */
export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string | null }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-muted">{label}</span>
      {children}
      {error && (
        <span className="flex items-center gap-1.5 text-[12.5px] text-danger">
          <CircleAlert size={14} aria-hidden />
          {error}
        </span>
      )}
    </label>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Título de seção com badge vermelho de contagem e link "Ver tudo" opcional. */
export function SectionHeader({
  title,
  count,
  href,
  linkLabel = "Ver tudo",
  as: Tag = "h2",
}: {
  title: string;
  count?: number;
  href?: string;
  linkLabel?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <Tag className="flex items-center gap-2 text-[16px] font-bold tracking-tight">
        {title}
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-badge px-2 py-0.5 text-[12px] font-semibold leading-none tabular-nums text-on-badge">
            {String(count).padStart(2, "0")}
          </span>
        )}
      </Tag>
      {href && <SeeAll href={href}>{linkLabel}</SeeAll>}
    </div>
  );
}

/** Link azul "Ver todas ›". */
export function SeeAll({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={clsx("inline-flex min-h-11 shrink-0 items-center gap-0.5 text-[13px] font-medium text-link hover:text-deep", className)}
    >
      {children}
      <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
    </Link>
  );
}

/** Chip em pílula: ativo em azul suave com texto azul escuro, inativo em vidro. */
export function chipClass(active: boolean) {
  return clsx(
    "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-5 text-[14px] transition",
    active ? "bg-accent-soft font-semibold text-deep shadow-soft" : "glass-card font-medium text-ink hover:text-primary",
  );
}

/** Etiqueta pequena. */
export function Tag({ tone = "warning", children }: { tone?: "warning" | "info"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold",
        tone === "warning" ? "bg-warning-soft text-warning" : "bg-white/20 text-white",
      )}
    >
      {children}
    </span>
  );
}

/** Aviso de lista de lançamentos incompleta (teto de segurança ou falha na leitura): totais são parciais. */
export function IncompleteNotice({ show, children }: { show: boolean; children?: ReactNode }) {
  if (!show) return null;
  return (
    <div role="alert" data-testid="lista-incompleta" className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
      {children ?? "Lista de lançamentos incompleta: há lançamentos demais no período ou a leitura falhou. Os totais abaixo são parciais."}
    </div>
  );
}

const BADGE_TONE = {
  info: "bg-accent-soft text-primary",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-surface-2 text-muted",
};

/** Selo em pílula (status). O texto sempre diz o estado; a cor só reforça. */
export function Badge({ tone = "info", children, className }: { tone?: keyof typeof BADGE_TONE; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold leading-none", BADGE_TONE[tone], className)}>
      {children}
    </span>
  );
}

/** Círculo de ícone (tiles e listas). */
export function IconCircle({ children, size = 42, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <span className={clsx("tic", className)} style={{ width: size, height: size }} aria-hidden>
      {children}
    </span>
  );
}

/** Chave liga/desliga (checkbox com papel de switch). */
export function Switch({ className, ...props }: Omit<ComponentProps<"input">, "type" | "role">) {
  return <input type="checkbox" role="switch" className={clsx("switch", className)} {...props} />;
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm text-danger">
      <CircleAlert size={15} aria-hidden className="shrink-0" />
      {message}
    </p>
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={clsx(fieldBase, "h-11 appearance-none", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={clsx(fieldBase, "min-h-20 py-3", className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ComponentProps<"a"> & { variant?: BtnVariant; size?: BtnSize }) {
  return (
    <a className={clsx(btnBase, btnSize[size], btnVariant[variant], className)} {...props}>
      <TapArea />
      {children}
    </a>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="glass rounded-[20px] border border-dashed border-line px-5 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}
