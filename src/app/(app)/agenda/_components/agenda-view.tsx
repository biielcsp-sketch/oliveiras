"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, ExternalLink, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, chipClass, EmptyState } from "@/components/ui";
import { Modal } from "@/components/modal";
import { longDayLabel } from "@/lib/agenda/dates";
import { safeHex, timeLabel, untitled, whenLabel, type AgendaEvent } from "@/lib/agenda/view";
import { autoSyncAgenda, deleteAgendaEvent } from "../actions";
import { EventForm, type CalendarOption } from "./event-form";

type Group = { day: string; events: AgendaEvent[] };
type Person = { id: string; label: string };

export function AgendaView({
  groups,
  today,
  people,
  calendars,
  prevHref,
  nextHref,
  todayHref,
  rangeLabel,
  canSync,
}: {
  groups: Group[];
  today: string;
  people: Person[];
  calendars: CalendarOption[];
  prevHref: string;
  nextHref: string;
  todayHref: string | null;
  rangeLabel: string;
  canSync: boolean;
}) {
  const router = useRouter();
  const [person, setPerson] = useState<string>("todos");
  const [open, setOpen] = useState<AgendaEvent | null>(null);
  const [form, setForm] = useState<{ event?: AgendaEvent } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  // Sincronização automática ao abrir (no máximo a cada 5 min, decidido no servidor).
  useEffect(() => {
    if (!canSync) return;
    let alive = true;
    void autoSyncAgenda().then((r) => {
      if (alive && r.changed) router.refresh();
    });
    return () => {
      alive = false;
    };
  }, [canSync, router]);

  const visible = groups.map((g) => ({
    ...g,
    events: person === "todos" ? g.events : g.events.filter((e) => e.memberId === person),
  }));
  const total = new Set(visible.flatMap((g) => g.events.map((e) => e.id))).size;

  const closeDetails = () => {
    setOpen(null);
    setConfirmDelete(false);
    setDeleteError(null);
  };
  const onFormDone = useCallback((message: string) => {
    setForm(null);
    setNotice(message);
  }, []);

  return (
    <section aria-label="Eventos" className="flex flex-col gap-4">
      <div className="glass-card flex items-center justify-between gap-2 rounded-[20px] px-2 py-1.5">
        <Link href={prevHref} aria-label="Semana anterior" className="grid size-11 place-items-center rounded-full text-deep transition hover:bg-accent-soft">
          <ChevronLeft size={20} aria-hidden />
        </Link>
        <div className="text-center">
          <p className="text-[15.5px] font-bold">{rangeLabel}</p>
          {todayHref && (
            <Link href={todayHref} className="text-[13px] font-medium text-link">
              Voltar para hoje
            </Link>
          )}
        </div>
        <Link href={nextHref} aria-label="Próxima semana" className="grid size-11 place-items-center rounded-full text-deep transition hover:bg-accent-soft">
          <ChevronRight size={20} aria-hidden />
        </Link>
      </div>

      {calendars.length > 0 && (
        <Button type="button" size="sm" className="self-start" onClick={() => setForm({})}>
          <Plus size={15} aria-hidden /> Novo evento
        </Button>
      )}

      <div className="-mx-2 -my-2 flex items-center gap-2 overflow-x-auto px-2 py-2" role="group" aria-label="Filtrar por pessoa">
        {[{ id: "todos", label: "Todos" }, ...people].map((p) => (
          <button key={p.id} type="button" aria-pressed={person === p.id} onClick={() => setPerson(p.id)} className={chipClass(person === p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <p role="status" className="min-h-5 text-sm text-primary">
        {notice}
      </p>

      {total === 0 && <EmptyState title="Nenhum evento neste período.">Conecte o Google abaixo ou crie um evento.</EmptyState>}

      <ol className="flex flex-col gap-3">
        {visible.map(({ day, events }) => {
          const isToday = day === today;
          if (!events.length && !isToday) return null;
          return (
            <li key={day} aria-current={isToday ? "date" : undefined}>
              <div className={clsx("glass-card rounded-[20px] p-4", isToday && "ring-2 ring-primary/40")}>
                <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
                  {isToday && <span className="rounded-full bg-hero px-2.5 py-1 text-[12px] font-semibold leading-none text-white shadow-[0_4px_10px_rgb(10_85_190/0.35)]">Hoje</span>}
                  {longDayLabel(day)}
                </h3>
                {events.length === 0 ? (
                  <p className="text-sm text-muted">Nada marcado.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {events.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setOpen(e)}
                          className="flex min-h-11 w-full items-start gap-3 py-2.5 text-left"
                          data-testid="evento"
                        >
                          <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: safeHex(e.color) }} aria-hidden />
                          <span className="w-24 shrink-0 text-[13px] tabular-nums text-muted">{timeLabel(e, day)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium">{untitled(e.title)}</span>
                            <span className="block truncate text-[12px] text-muted">
                              {[e.owner, e.location].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <Modal open={open !== null} onClose={closeDetails} title={open ? untitled(open.title) : ""}>
        {open && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
              <dt className="text-muted">Quando</dt>
              <dd>{whenLabel(open)}</dd>
              {open.location && (
                <>
                  <dt className="text-muted">
                    <MapPin size={16} aria-label="Local" />
                  </dt>
                  <dd className="break-words">{open.location}</dd>
                </>
              )}
              <dt className="text-muted">Agenda</dt>
              <dd className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: safeHex(open.color) }} aria-hidden />
                {open.calendarName} · {open.owner}
              </dd>
            </dl>
            {open.description && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{open.description}</p>}
            {open.htmlLink && (
              <a href={open.htmlLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-link">
                Abrir no Google <ExternalLink size={16} aria-hidden />
              </a>
            )}
            {open.editable ? (
              confirmDelete ? (
                <div role="group" aria-label="Confirmar exclusão" className="rounded-2xl bg-surface-2 p-3">
                  <p className="text-[15px]">Apagar este evento também no Google?</p>
                  {deleteError && <p className="mt-1 text-sm text-danger">{deleteError}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      Manter
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="font-semibold text-danger"
                      disabled={deleting}
                      onClick={() =>
                        startDelete(async () => {
                          const r = await deleteAgendaEvent(open.id);
                          if (r.ok) {
                            closeDetails();
                            setNotice("Evento apagado.");
                          } else setDeleteError(r.erro);
                        })
                      }
                    >
                      {deleting ? "Apagando…" : "Apagar"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={18} aria-hidden /> Apagar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const ev = open;
                      closeDetails();
                      setForm({ event: ev });
                    }}
                  >
                    <Pencil size={18} aria-hidden /> Editar
                  </Button>
                </div>
              )
            ) : (
              <p className="text-[13px] text-muted">Só {open.owner === "Você" ? "você" : open.owner} pode editar este evento.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.event ? "Editar evento" : "Novo evento"}>
        {form && <EventForm event={form.event} calendars={calendars} defaultDay={today} onDone={onFormDone} />}
      </Modal>
    </section>
  );
}
