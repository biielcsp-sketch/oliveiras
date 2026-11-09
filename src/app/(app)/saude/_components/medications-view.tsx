"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/saude/input";
import { splitMedications } from "@/lib/saude/view";
import { deleteMedication, saveMedication, setMedicationActive, type SaudeState } from "../actions";
import { ConfirmDelete, type Person } from "./shared";

export type MedicationVM = {
  id: string;
  memberId: string;
  person: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  startedOn: string | null;
  endedOn: string | null;
  active: boolean;
  prescribedBy: string | null;
  notes: string | null;
};

function MedicationForm({ item, people, defaultMember, onDone }: { item?: MedicationVM; people: Person[]; defaultMember: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<SaudeState, FormData>(saveMedication, null);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-4"
    >
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Pessoa">
        <Select name="member_id" defaultValue={item?.memberId ?? defaultMember} required>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Medicamento">
        <Input name="name" maxLength={LIMITS.medName} defaultValue={item?.name} placeholder="Ex.: Amoxicilina" required autoComplete="off" />
      </Field>
      <Field label="Dose">
        <Input name="dosage" maxLength={LIMITS.dosage} defaultValue={item?.dosage ?? ""} placeholder="Ex.: 500 mg" autoComplete="off" />
      </Field>
      <Field label="Frequência">
        <Input name="frequency" maxLength={LIMITS.frequency} defaultValue={item?.frequency ?? ""} placeholder="Ex.: a cada 8 horas" autoComplete="off" />
      </Field>
      <Field label="Início do uso">
        <Input name="started_on" type="date" defaultValue={item?.startedOn ?? ""} />
      </Field>
      <Field label="Fim do uso (deixe vazio se continua em uso)">
        <Input name="ended_on" type="date" defaultValue={item?.endedOn ?? ""} />
      </Field>
      <Field label="Prescrito por">
        <Input name="prescribed_by" maxLength={LIMITS.doctor} defaultValue={item?.prescribedBy ?? ""} autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.medNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : item ? "Salvar alterações" : "Salvar medicamento"}</Button>
    </form>
  );
}

export function MedicationsView({ people, items, defaultMember }: { people: Person[]; items: MedicationVM[]; defaultMember: string }) {
  const [modal, setModal] = useState<{ item?: MedicationVM } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { active, ended } = splitMedications(items);

  async function run(fn: () => Promise<{ ok: boolean; erro?: string }>, done: string) {
    setPending(true);
    const r = await fn();
    setPending(false);
    setError(r.ok ? null : (r.erro ?? "Não foi possível atualizar."));
    setNotice(r.ok ? done : null);
  }

  function row(x: MedicationVM) {
    return (
      <Card key={x.id} data-testid="medicamento">
        <p className="text-lg font-medium">
          {x.name}
          {x.dosage ? ` — ${x.dosage}` : ""}
        </p>
        <p className="mt-1 text-sm">{x.person}</p>
        {x.frequency && <p className="text-sm text-muted">{x.frequency}</p>}
        {(x.startedOn || x.endedOn) && (
          <p className="text-sm text-muted">
            {x.startedOn ? `Desde ${brDate(x.startedOn)}` : ""}
            {x.startedOn && x.endedOn ? " · " : ""}
            {x.endedOn ? `Até ${brDate(x.endedOn)}` : ""}
          </p>
        )}
        {x.prescribedBy && <p className="text-sm text-muted">Prescrito por {x.prescribedBy}</p>}
        {x.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{x.notes}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-3 text-sm"
            disabled={pending}
            onClick={() => run(() => setMedicationActive(x.id, !x.active), x.active ? "Medicamento encerrado." : "Medicamento reativado.")}
          >
            {x.active ? "Encerrar" : "Reativar"}
          </Button>
          <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => setModal({ item: x })}>
            Editar
          </Button>
          <ConfirmDelete what="este medicamento" pending={pending} onConfirm={() => run(() => deleteMedication(x.id), "Medicamento apagado.")} />
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> Novo medicamento
        </Button>
      </div>
      {notice && (
        <p role="status" className="-mt-2 text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
      {items.length === 0 && <EmptyState title="Nenhum medicamento ainda.">Anote o que cada pessoa da família está tomando.</EmptyState>}
      {items.length > 0 && (
        <section aria-label="Medicamentos em uso" className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Em uso</h2>
          {active.length === 0 && <p className="text-sm text-muted">Nenhum medicamento em uso.</p>}
          {active.map(row)}
        </section>
      )}
      {ended.length > 0 && (
        <section aria-label="Medicamentos encerrados" className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Encerrados</h2>
          {ended.map(row)}
        </section>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar medicamento" : "Novo medicamento"}>
        <MedicationForm
          item={modal?.item}
          people={people}
          defaultMember={defaultMember}
          onDone={() => {
            setNotice(modal?.item ? "Medicamento atualizado." : "Medicamento salvo.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
