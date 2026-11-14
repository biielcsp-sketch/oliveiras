"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, FormError, Input, Select, SectionHeader, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { KIND_LABEL, LIMITS, STATUS_LABEL } from "@/lib/saude/input";
import type { AppointmentKind, AppointmentStatus } from "@/lib/saude/types";
import { deleteAppointment, retryAgendaSync, saveAppointment, setAppointmentStatus, type SaudeState } from "../actions";
import { ConfirmDelete, type Person } from "./shared";

export type AppointmentVM = {
  id: string;
  memberId: string;
  person: string;
  kind: AppointmentKind;
  specialty: string | null;
  doctor: string | null;
  place: string | null;
  /** Valor do datetime-local (horário de São Paulo). */
  local: string;
  whenLabel: string;
  status: AppointmentStatus;
  notes: string | null;
  returnOf: string | null;
  originLabel: string | null;
  synced: boolean;
};
export type OriginOption = { id: string; memberId: string; label: string };
type Draft = Partial<AppointmentVM>;

function AppointmentForm({ appt, draft, people, origins, defaultMember, onDone }: { appt?: AppointmentVM; draft?: Draft; people: Person[]; origins: OriginOption[]; defaultMember: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<SaudeState, FormData>(saveAppointment, null);
  const base = appt ?? draft ?? {};
  const [kind, setKind] = useState<AppointmentKind>(base.kind ?? "consulta");
  const [member, setMember] = useState(base.memberId ?? defaultMember);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  const options = origins.filter((o) => o.memberId === member && o.id !== appt?.id);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-4"
    >
      {appt && <input type="hidden" name="id" value={appt.id} />}
      <Field label="Pessoa">
        <Select name="member_id" value={member} onChange={(e) => setMember(e.target.value)} required>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tipo">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
          <option value="consulta">Consulta</option>
          <option value="retorno">Retorno</option>
        </Select>
      </Field>
      {kind === "retorno" && (
        <Field label="Retorno de qual consulta?">
          <Select name="return_of" defaultValue={base.returnOf ?? ""}>
            <option value="">Não vincular</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Especialidade">
        <Input name="specialty" maxLength={LIMITS.specialty} defaultValue={base.specialty ?? ""} placeholder="Ex.: Cardiologia" autoComplete="off" />
      </Field>
      <Field label="Médico">
        <Input name="doctor" maxLength={LIMITS.doctor} defaultValue={base.doctor ?? ""} autoComplete="off" />
      </Field>
      <Field label="Local">
        <Input name="place" maxLength={LIMITS.place} defaultValue={base.place ?? ""} autoComplete="off" />
      </Field>
      <Field label="Data e hora">
        <Input name="starts_at" type="datetime-local" defaultValue={base.local ?? ""} required />
      </Field>
      {appt && (
        <Field label="Situação">
          <Select name="status" defaultValue={appt.status}>
            {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.apptNotes} defaultValue={base.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : appt ? "Salvar alterações" : "Salvar"}</Button>
    </form>
  );
}

function Item({ a, onEdit, onReturn, run }: { a: AppointmentVM; onEdit: () => void; onReturn: () => void; run: (fn: () => Promise<{ ok: boolean; erro?: string }>, ok: string) => void }) {
  return (
    <Card data-testid="consulta">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-medium">
          {KIND_LABEL[a.kind]}
          {a.specialty ? ` — ${a.specialty}` : ""}
        </p>
        <span className={a.status === "agendada" ? "inline-flex h-7 items-center rounded-full bg-warning-soft px-2.5 text-[12px] font-medium text-warning" : "inline-flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-muted"}>{STATUS_LABEL[a.status]}</span>
      </div>
      <p className="mt-1 text-sm">
        {a.person} · {a.whenLabel}
      </p>
      {a.doctor && <p className="text-sm text-muted">{a.doctor}</p>}
      {a.place && <p className="text-sm text-muted">{a.place}</p>}
      {a.originLabel && <p className="text-sm text-muted">Retorno de {a.originLabel}</p>}
      {a.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{a.notes}</p>}
      {a.status === "agendada" && !a.synced && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-warning">
          Não sincronizada com a Agenda
          <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => run(() => retryAgendaSync(a.id), "Sincronizada com a Agenda.")}>
            Tentar de novo
          </Button>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={onEdit}>
          Editar
        </Button>
        {a.status === "agendada" && (
          <>
            <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => run(() => setAppointmentStatus(a.id, "realizada"), "Marcada como realizada.")}>
              Marcar como realizada
            </Button>
            <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => run(() => setAppointmentStatus(a.id, "cancelada"), "Consulta cancelada.")}>
              Cancelar consulta
            </Button>
          </>
        )}
        {a.kind === "consulta" && (
          <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={onReturn}>
            Marcar retorno
          </Button>
        )}
        <ConfirmDelete what="esta consulta" onConfirm={() => run(() => deleteAppointment(a.id), "Consulta apagada.")} />
      </div>
    </Card>
  );
}

export function AppointmentsView({ people, upcoming, past, origins, defaultMember }: { people: Person[]; upcoming: AppointmentVM[]; past: AppointmentVM[]; origins: OriginOption[]; defaultMember: string }) {
  const [modal, setModal] = useState<{ appt?: AppointmentVM; draft?: Draft } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; erro?: string }>, okText: string) {
    void fn().then((r) => {
      setError(r.ok ? null : (r.erro ?? "Não foi possível concluir."));
      setNotice(r.ok ? okText : null);
    });
  }
  const list = (items: AppointmentVM[]) =>
    items.map((a) => (
      <Item
        key={a.id}
        a={a}
        run={run}
        onEdit={() => setModal({ appt: a })}
        onReturn={() => setModal({ draft: { kind: "retorno", memberId: a.memberId, specialty: a.specialty, doctor: a.doctor, place: a.place, returnOf: a.id } })}
      />
    ));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex">
        <Button size="sm" onClick={() => setModal({})}>
          <Plus size={15} aria-hidden /> Nova consulta
        </Button>
      </div>
      {notice && (
        <p role="status" className="-mt-4 text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
      <section aria-label="Próximas consultas" className="flex flex-col gap-3">
        <SectionHeader title="Próximas" count={upcoming.length} />
        {upcoming.length ? list(upcoming) : <EmptyState title="Nenhuma consulta marcada." />}
      </section>
      <section aria-label="Consultas passadas" className="flex flex-col gap-3">
        <SectionHeader title="Passadas" />
        {past.length ? list(past) : <EmptyState title="Nada por aqui ainda." />}
      </section>
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.appt ? "Editar consulta" : "Nova consulta"}>
        <AppointmentForm
          appt={modal?.appt}
          draft={modal?.draft}
          people={people}
          origins={origins}
          defaultMember={defaultMember}
          onDone={() => {
            setNotice(modal?.appt ? "Consulta atualizada." : "Consulta salva.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
