"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export type Person = { id: string; name: string };

/** Arquivo anexado: PDF abre em nova aba (a CSP não deixa embutir); JPG aparece como imagem. */
export function FileLink({ href, mime, label, preview }: { href: string; mime: string; label: string; preview?: boolean }) {
  if (mime === "image/jpeg" && preview) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 block">
        {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada; o otimizador de imagens do Next não tem a sessão */}
        <img src={href} alt={label} loading="lazy" className="max-h-48 rounded-xl border border-line object-contain" />
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[15px] font-medium text-link">
      {mime === "application/pdf" ? "Abrir PDF" : "Abrir foto"}
    </a>
  );
}

/** Botão "Apagar" com confirmação em duas etapas. */
export function ConfirmDelete({ label = "Apagar", what, onConfirm, pending }: { label?: string; what: string; onConfirm: () => void; pending?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button type="button" variant="danger" className="h-11 px-3 text-sm" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <span role="group" aria-label="Confirmar exclusão" className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">Apagar {what}?</span>
      <Button type="button" variant="danger" className="h-11 px-3 text-sm" disabled={pending} onClick={onConfirm}>
        {label}
      </Button>
      <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => setAsking(false)}>
        Cancelar
      </Button>
    </span>
  );
}
