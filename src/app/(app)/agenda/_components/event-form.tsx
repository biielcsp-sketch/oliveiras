"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { saveEvent, type AgendaFormState } from "../actions";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { EVENT_LIMITS } from "@/lib/agenda/input";
import { formValues, type AgendaEvent } from "@/lib/agenda/view";

export type CalendarOption = { id: string; summary: string };

/** Novo evento (sem `event`) ou edição. O servidor valida tudo de novo e grava no Google. */
export function EventForm({
  event,
  calendars,
  defaultDay,
  onDone,
}: {
  event?: AgendaEvent;
  calendars: CalendarOption[];
  defaultDay: string;
  onDone: (message: string) => void;
}) {
  const [state, action, pending] = useActionState<AgendaFormState, FormData>(saveEvent, null);
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const initial = event ? formValues(event) : null;
  const startLocal = initial && !event?.allDay ? initial.start : `${defaultDay}T09:00`;
  const endLocal = initial && !event?.allDay ? initial.end : `${defaultDay}T10:00`;
  const startDate = initial ? initial.start.slice(0, 10) : defaultDay;
  const endDate = initial ? initial.end.slice(0, 10) : defaultDay;

  useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Salvo.");
  }, [state, onDone]);

  return (
    <form
      // onSubmit em vez de action: com erro, o que a pessoa digitou continua no formulário (action reseta os campos).
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-4"
    >
      {event && <input type="hidden" name="id" value={event.id} />}
      <Field label="Título">
        <Input name="title" maxLength={EVENT_LIMITS.title} defaultValue={event?.title} required autoComplete="off" />
      </Field>

      <label className="flex min-h-11 items-center gap-3 text-[15px]">
        <input
          type="checkbox"
          name="all_day"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="size-5 accent-[var(--primary)]"
        />
        Dia inteiro
      </label>

      {allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <Input name="start_date" type="date" defaultValue={startDate} required />
          </Field>
          <Field label="Fim">
            <Input name="end_date" type="date" defaultValue={endDate} required />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <Field label="Início">
            <Input name="start" type="datetime-local" defaultValue={startLocal} required />
          </Field>
          <Field label="Fim">
            <Input name="end" type="datetime-local" defaultValue={endLocal} required />
          </Field>
        </div>
      )}

      <Field label="Local">
        <Input name="location" maxLength={EVENT_LIMITS.location} defaultValue={event?.location ?? ""} autoComplete="off" />
      </Field>
      <Field label="Descrição">
        <Textarea name="description" maxLength={EVENT_LIMITS.description} defaultValue={event?.description ?? ""} rows={3} />
      </Field>

      {event ? (
        <p className="text-[13px] text-muted">Agenda: {event.calendarName}</p>
      ) : (
        <Field label="Agenda">
          <Select name="calendar_id" defaultValue={calendars[0]?.id} required>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div role="alert" aria-live="assertive">
        <FormError message={state?.error} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : event ? "Salvar alterações" : "Criar evento"}
      </Button>
    </form>
  );
}
