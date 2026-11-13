import Link from "next/link";
import { OliSphere } from "@/components/oli/oli-sphere";

export const metadata = { title: "Página não encontrada" };

/** 404 do app (sem estilo inline: respeita a CSP com nonce). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-9 py-12 text-center">
      <div className="relative grid size-60 place-items-center rounded-full bg-[radial-gradient(circle,var(--surface-solid)_0%,var(--soft)_58%,transparent_72%)]">
        <OliSphere size={176} label="Oli" />
      </div>
      <h1 className="mt-3 text-[22px] font-bold leading-tight tracking-tight">
        Conte sempre
        <br />
        com o Oliveira&apos;s!
      </h1>
      <p className="mt-2.5 text-[14px] leading-normal text-muted">
        Sua vida mais organizada,
        <br />
        com propósito e fé.
      </p>
      <Link
        href="/inicio"
        className="glass-primary mt-7 inline-flex h-12 w-[260px] max-w-full items-center justify-center rounded-full text-[15px] font-semibold"
      >
        Voltar para o início
      </Link>
    </main>
  );
}
