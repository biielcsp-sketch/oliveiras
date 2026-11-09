"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * <dialog> modal nativo (foco preso, Esc fecha). Fecha também no clique fora e no X.
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
      className="calendar-dialog m-auto max-h-[90dvh] w-[min(94vw,440px)] overflow-y-auto rounded-[24px] border border-line bg-surface-solid p-0 text-ink shadow-card"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={titleId} className="pt-2 text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 transition hover:bg-accent-soft"
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
