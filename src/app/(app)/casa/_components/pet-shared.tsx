"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Field, FormError } from "@/components/ui";
import type { PetState } from "../pet-actions";
import { fileInputClass } from "../../saude/_components/shared";
import { useOnSaved } from "./shared";

/** Formulário de uma server action da aba Pet: envia o FormData, mostra o erro e avisa no sucesso. */
export function ActionForm({
  action,
  onDone,
  submit,
  children,
  label,
  prepare,
  busy,
}: {
  action: (s: PetState, f: FormData) => Promise<PetState>;
  onDone: (msg?: string, id?: string) => void;
  submit: string;
  children: ReactNode;
  label?: string;
  /** Ajusta o FormData antes de enviar (ex.: foto já reduzida no navegador). */
  prepare?: (data: FormData) => void | Promise<void>;
  /** Enquanto true (ex.: foto sendo preparada), o botão fica desabilitado. */
  busy?: boolean;
}) {
  const [state, run, pending] = useActionState<PetState, FormData>(action, null);
  useOnSaved(state, (msg) => onDone(msg, state?.id));
  return (
    <form
      aria-label={label}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        await prepare?.(data); // espera a foto terminar de ser preparada (Enter/duplo toque)
        startTransition(() => run(data));
      }}
      className="flex flex-col gap-4"
    >
      {children}
      <FormError message={state?.error} />
      <Button disabled={pending || busy}>{pending ? "Salvando…" : submit}</Button>
    </form>
  );
}

/** Anexo opcional (PDF/JPG até 5 MB) com "remover o atual" na edição. */
export function FileFields({ hasFile }: { hasFile: boolean }) {
  return (
    <>
      <Field label={hasFile ? "Trocar anexo (PDF ou JPG, até 5 MB)" : "Anexo opcional (PDF ou JPG, até 5 MB)"}>
        <input name="file" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" className={fileInputClass} />
      </Field>
      {hasFile && (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" name="remove_file" className="size-5 accent-[var(--primary)]" />
          Remover o anexo atual
        </label>
      )}
    </>
  );
}

const tagTone = { danger: "bg-danger/15 text-danger", warning: "bg-warning-soft text-warning", info: "bg-accent-soft text-primary" } as const;

export function StatusTag({ tone, children }: { tone: keyof typeof tagTone; children: ReactNode }) {
  return <span className={clsx("inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium", tagTone[tone])}>{children}</span>;
}

/** Número em reais para o campo de edição ("150,00"). */
export const brlInput = (n: number | null) => (n === null ? "" : n.toFixed(2).replace(".", ","));
/** Decimal para o campo de edição ("12,5"). */
export const decInput = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));
