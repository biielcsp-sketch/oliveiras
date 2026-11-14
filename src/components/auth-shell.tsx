import type { ReactNode } from "react";
import { OliSphere } from "@/components/oli/oli-sphere";

/** Moldura das telas de entrada (bem-vindo, esqueci/redefinir senha): esfera do Oli, título e conteúdo em vidro. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-[124px] place-items-center rounded-full bg-[radial-gradient(circle,var(--surface-solid)_0%,var(--soft)_58%,transparent_72%)]">
          <OliSphere size={84} />
        </span>
        <h1 className="mt-3 text-[22px] font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <div className="glass-card rounded-[24px] p-5">{children}</div>
      {footer}
    </main>
  );
}
