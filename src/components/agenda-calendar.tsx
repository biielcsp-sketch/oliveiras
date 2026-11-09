"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { WEEKDAYS, dayLabel, monthGrid, monthLabel, shiftMonth, yearMonthOf, type YearMonth } from "@/lib/calendar";
import { todaySP } from "@/lib/financas/today";
import { dotsByDay, eventDays, safeHex, timeLabel, untitled, type AgendaEvent } from "@/lib/agenda/view";
import { autoSyncAgenda, getMonthEvents } from "@/app/(app)/agenda/actions";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Botão que abre o calendário do mês em um <dialog> modal centralizado.
 * Fecha com Esc (nativo), clique fora e botão X. Pontinhos nos dias com eventos; tocar num dia lista os eventos.
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
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const titleId = useId();
  const listId = useId();
  const monthKey = shown ? `${shown.year}-${pad(shown.month)}` : null;

  useEffect(() => {
    if (!isOpen || !monthKey) return;
    let alive = true;
    void getMonthEvents(monthKey)
      .then((r) => alive && setEvents(r.events))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [isOpen, monthKey, syncTick]);

  function open() {
    // Data calculada ao abrir (fuso de São Paulo), sem divergência de hidratação
    const t = todaySP();
    setToday(t);
    setShown(yearMonthOf(t));
    setSelected(t);
    setIsOpen(true);
    dialogRef.current?.showModal();
    // Sincroniza em segundo plano (no máximo a cada 5 min); se mudou, recarrega o mês.
    void autoSyncAgenda()
      .then((r) => r.changed && setSyncTick((n) => n + 1))
      .catch(() => null);
  }

  function close() {
    dialogRef.current?.close();
  }

  const weeks = shown ? monthGrid(shown) : [];
  const title = shown ? monthLabel(shown) : "";
  const dots = dotsByDay(events);
  const dayEvents = selected ? events.filter((e) => eventDays(e).includes(selected)) : [];

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
        onClose={() => {
          setIsOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(e) => {
          // Clique no fundo (fora do conteúdo) fecha
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                if (!shown) return;
                setShown(shiftMonth(shown, -1));
                setSelected(null);
              }}
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
              onClick={() => {
                if (!shown) return;
                setShown(shiftMonth(shown, 1));
                setSelected(null);
              }}
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
                    const marks = day ? (dots[day] ?? []) : [];
                    const isSel = day === selected;
                    return (
                      <td key={j} className="p-0">
                        {day && (
                          <button
                            type="button"
                            onClick={() => setSelected(day)}
                            aria-pressed={isSel}
                            aria-controls={listId}
                            aria-current={isToday ? "date" : undefined}
                            className={clsx(
                              "relative mx-auto grid size-10 place-items-center rounded-full tabular-nums transition",
                              isToday ? "bg-hero font-semibold text-on-primary shadow-soft" : "text-ink hover:bg-accent-soft",
                              isSel && !isToday && "bg-accent-soft font-semibold",
                              isSel && "ring-2 ring-primary",
                            )}
                          >
                            <span aria-hidden>{Number(day.slice(8))}</span>
                            <span className="sr-only">
                              {isToday ? `Hoje, ${dayLabel(day)}` : dayLabel(day)}
                              {marks.length ? ", com eventos" : ""}
                            </span>
                            {marks.length > 0 && (
                              <span className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5" aria-hidden data-testid="ponto-evento">
                                {marks.map((c) => (
                                  <span key={c} className="size-1.5 rounded-full ring-1 ring-surface-solid" style={{ background: c }} />
                                ))}
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div id={listId} aria-live="polite" className="mt-3 min-h-12">
            {selected && (
              <>
                <h3 className="text-[13px] font-medium text-muted">{dayLabel(selected)}</h3>
                {dayEvents.length === 0 ? (
                  <p className="mt-1 text-[14px] text-muted">Nenhum evento.</p>
                ) : (
                  <ul className="mt-1 flex max-h-44 flex-col gap-1 overflow-y-auto" aria-label="Eventos do dia">
                    {dayEvents.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 text-[14px]">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: safeHex(e.color) }} aria-hidden />
                        <span className="w-24 shrink-0 tabular-nums text-muted">{timeLabel(e, selected)}</span>
                        <span className="min-w-0 flex-1 truncate">{untitled(e.title)}</span>
                        <span className="shrink-0 text-[12px] text-muted">{e.owner}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

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
