"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import { Share2 } from "lucide-react";
import { Button, FormError } from "@/components/ui";
import { useOnSaved } from "../../casa/_components/shared";

export { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner } from "../../casa/_components/shared";

export type FormState = { ok?: boolean; error?: string; message?: string; id?: string } | null;

/** Formulário de uma server action: envia o FormData, mostra o erro e avisa no sucesso. */
export function ActionForm({
  action,
  onDone,
  submit,
  children,
  label,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  onDone: (msg?: string, id?: string) => void;
  submit: string;
  children: ReactNode;
  label?: string;
}) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, null);
  useOnSaved(state, (msg) => onDone(msg, state?.id));
  return (
    <form
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
      className="flex flex-col gap-4"
    >
      {children}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : submit}</Button>
    </form>
  );
}

/** Caixa "Compartilhar com a família" (somente leitura para o outro). */
export function ShareField({ defaultChecked }: { defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-[15px]">
      <input type="checkbox" name="shared" defaultChecked={defaultChecked} className="size-5 accent-[var(--color-primary)]" />
      <span>
        Compartilhar com a família
        <span className="block text-[13px] text-muted">Quem é da família só lê; não edita.</span>
      </span>
    </label>
  );
}

/** Marca do item: "compartilhado por Karen" (do outro) ou "Compartilhado" (meu, compartilhado). */
export function ShareBadge({ mine, shared, sharedBy }: { mine: boolean; shared: boolean; sharedBy: string | null }) {
  if (!mine && sharedBy)
    return (
      <p className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
        <Share2 size={14} aria-hidden /> {sharedBy}
      </p>
    );
  if (mine && shared)
    return (
      <p className="inline-flex items-center gap-1 text-[13px] text-muted">
        <Share2 size={14} aria-hidden /> Compartilhado com a família
      </p>
    );
  return null;
}

/** Texto do usuário (ou da IA) como texto puro, preservando as quebras de linha pelo CSS. */
export function Multiline({ text, className = "" }: { text: string; className?: string }) {
  return <p className={`whitespace-pre-wrap break-words ${className}`}>{text}</p>;
}
