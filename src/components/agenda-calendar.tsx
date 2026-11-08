"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { WEEKDAYS, dayLabel, monthGrid, monthLabel, shiftMonth, yearMonthOf, type YearMonth } from "@/lib/calendar";
import { todaySP } from "@/lib/financas/today";

/**
 * Botão que abre o calendário do mês em um <dialog> modal centralizado.
 * Fecha com Esc (nativo), clique fora e botão X. Sem eventos ainda (fase 3).
 */
export function AgendaCalendarButton({
  className,
  children,
  label = "Agenda",
}: {
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [today, setToday] = useState<string | null>(null);
  const [shown, setShown] = useState<YearMonth | null>(null);
  const titleId = useId();

  function open() {
    // Data calculada ao abrir (fuso de São Paulo), sem divergência de hidratação
    const t = todaySP();
    setToday(t);
    setShown(yearMonthOf(t));
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  const weeks = shown ? monthGrid(shown) : [];
  const title = shown ? monthLabel(shown) : "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={className}
      >
        {children}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="calendar-dialog m-auto w-[min(92vw,380px)] rounded-[24px] border border-line bg-surface-solid p-0 text-ink shadow-card"
        onClose={() => triggerRef.current?.focus()}
        onClick={(e) => {
          // Clique no fundo (fora do conteúdo) fecha
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => shown && setShown(shiftMonth(shown, -1))}
              aria-label="Mês anterior"
              className="grid size-11 place-items-center rounded-full bg-surface-2 transition hover:bg-accent-soft"
            >
              <ChevronLeft size={20} aria-hidden />
            </button>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight" aria-live="polite">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => shown && setShown(shiftMonth(shown, 1))}
              aria-label="Próximo mês"
              className="grid size-11 place-items-center rounded-full bg-surface-2 transition hover:bg-accent-soft"
            >
              <ChevronRight size={20} aria-hidden />
            </button>
          </div>

          <table className="mt-4 w-full table-fixed border-separate border-spacing-y-1 text-center text-[15px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d.long} scope="col" abbr={d.long} className="pb-1 text-[13px] font-medium text-muted">
                    <span aria-hidden>{d.short}</span>
                    <span className="sr-only">{d.long}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, i) => (
                <tr key={i}>
                  {week.map((day, j) => {
                    const isToday = day === today;
                    return (
                      <td key={j} className="p-0">
                        {day && (
                          <span
                            aria-current={isToday ? "date" : undefined}
                            className={clsx(
                              "mx-auto grid size-10 place-items-center rounded-full tabular-nums",
                              isToday ? "bg-hero font-semibold text-on-primary shadow-soft" : "text-ink",
                            )}
                          >
                            <span aria-hidden>{Number(day.slice(8))}</span>
                            <span className="sr-only">{isToday ? `Hoje, ${dayLabel(day)}` : dayLabel(day)}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-3 text-center text-[13px] text-muted">Os eventos da família chegam na fase 3.</p>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Link
              href="/agenda"
              onClick={close}
              className="inline-flex h-11 items-center gap-2 rounded-full px-1 text-[15px] font-medium text-link"
            >
              Abrir agenda
              <ChevronRight size={18} aria-hidden className="rounded-full border border-current p-px" />
            </Link>
            <button
              type="button"
              onClick={close}
              aria-label="Fechar calendário"
              className="grid size-11 place-items-center rounded-full bg-surface-2 transition hover:bg-accent-soft"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
