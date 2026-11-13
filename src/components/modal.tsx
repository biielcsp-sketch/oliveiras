"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * <dialog> modal nativo (foco preso, Esc fecha). Fecha também no clique fora e no X.
 * Visual de folha: no celular sobe do rodapé (cantos de 28px e alça); no desktop fica centralizado.
 * Aberto enquanto `open` for true; `onClose` avisa quem controla o estado.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="calendar-dialog mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] border-0 bg-[linear-gradient(180deg,var(--sheet-from),var(--sheet-to))] p-0 text-ink shadow-[0_-10px_30px_rgb(10_60_160/0.18)] md:m-auto md:w-[min(94vw,480px)] md:rounded-[28px]"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2.5 md:pb-6">
          <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-line md:hidden" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-bold tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--bg)] text-ink transition hover:bg-accent-soft"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
