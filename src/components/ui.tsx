import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** Card de vidro com brilho (radius 24). `tone="hero"`: card de destaque em vidro azul (mesmo azul do botão principal), texto branco. */
export function Card({ className, tone = "glass", ...props }: ComponentProps<"div"> & { tone?: "glass" | "hero" }) {
  return (
    <div
      className={clsx(
        "rounded-[24px] p-5",
        tone === "glass" ? "glass glass-shine border border-[var(--glass-edge)] shadow-glass" : "glass-primary",
        className,
      )}
      {...props}
    />
  );
}

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-full text-[15px] font-medium transition active:scale-[0.98] disabled:opacity-50";

const btnVariant = {
  primary: "glass-primary hover:brightness-110",
  ghost: "glass glass-shine border border-[var(--glass-edge)] text-ink shadow-glass hover:brightness-105",
  danger: "text-danger hover:bg-surface-2",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" }) {
  return <button className={clsx(btnBase, "h-12 px-5", btnVariant[variant], className)} {...props} />;
}

const fieldBase =
  "w-full rounded-2xl border border-transparent bg-surface-2 px-4 text-[15px] text-ink outline-none transition placeholder:text-muted focus:border-primary focus:bg-surface-solid";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(fieldBase, "h-12", className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
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
    <header className="mb-7 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Título de seção (20px) com badge vermelho de contagem e link "Ver tudo" opcional. */
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
    <div className="mb-4 flex items-center justify-between gap-3">
      <Tag className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        {title}
        {count !== undefined && count > 0 && (
          <span className="rounded-md bg-badge px-1.5 py-0.5 text-[13px] font-medium leading-none tabular-nums text-on-badge">
            {String(count).padStart(2, "0")}
          </span>
        )}
      </Tag>
      {href && <SeeAll href={href}>{linkLabel}</SeeAll>}
    </div>
  );
}

/** Link azul com ícone circular, como o "View all" da referência. */
export function SeeAll({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={clsx("inline-flex min-h-11 shrink-0 items-center gap-1.5 text-[15px] font-medium text-link", className)}
    >
      {children}
      <ChevronRight size={16} strokeWidth={2.2} aria-hidden className="rounded-full border-[1.5px] border-current" />
    </Link>
  );
}

/** Chip em pílula: ativo em accent-soft, inativo em surface-2. */
export function chipClass(active: boolean) {
  return clsx(
    "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] transition",
    active ? "bg-accent-soft font-medium text-ink shadow-soft" : "bg-surface-2 text-ink hover:bg-accent-soft",
  );
}

/** Etiqueta pequena (como "Low Temp" / "Turbo" da referência). */
export function Tag({ tone = "warning", children }: { tone?: "warning" | "info"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium",
        tone === "warning" ? "bg-warning-soft text-warning" : "bg-white/10 text-on-primary",
      )}
    >
      {children}
    </span>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-danger">{message}</p>;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={clsx(fieldBase, "h-12 appearance-none", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={clsx(fieldBase, "min-h-20 py-3", className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"a"> & { variant?: "primary" | "ghost" }) {
  return <a className={clsx(btnBase, "h-11 px-4", btnVariant[variant], className)} {...props} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="glass rounded-[24px] border border-dashed border-line px-5 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}
