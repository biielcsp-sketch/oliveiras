"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { FileButtons } from "@/components/file-buttons";
import { Button, Card, chipClass, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/saude/input";
import { formatSize } from "@/lib/saude/files";
import { isOverdue } from "@/lib/saude/view";
import { deleteVaccine, saveVaccine, type SaudeState } from "../actions";
import { PushNotifications } from "./push-notifications";
import { ConfirmDelete, FileLink, type Person } from "./shared";

export type VaccineVM = {
  id: string;
  memberId: string;
  person: string;
  name: string;
  dose: string | null;
  appliedOn: string | null;
  nextDoseOn: string | null;
  place: string | null;
  lot: string | null;
  notes: string | null;
  mime: "application/pdf" | "image/jpeg" | null;
  size: number | null;
};

type VaccinePerson = Person & { child: boolean };

function VaccineForm({ item, people, defaultMember, onDone }: { item?: VaccineVM; people: Person[]; defaultMember: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<SaudeState, FormData>(saveVaccine, null);
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
      <Field label="Vacina">
        <Input name="name" maxLength={LIMITS.vaccineName} defaultValue={item?.name} placeholder="Ex.: Hepatite B" required autoComplete="off" />
      </Field>
      <Field label="Dose">
        <Input name="dose_label" maxLength={LIMITS.doseLabel} defaultValue={item?.dose ?? ""} placeholder="Ex.: 2ª dose, reforço" autoComplete="off" />
      </Field>
      <Field label="Data de aplicação">
        <Input name="applied_on" type="date" defaultValue={item?.appliedOn ?? ""} />
      </Field>
      <Field label="Próxima dose">
        <Input name="next_dose_on" type="date" defaultValue={item?.nextDoseOn ?? ""} />
      </Field>
      <Field label="Local">
        <Input name="place" maxLength={LIMITS.place} defaultValue={item?.place ?? ""} autoComplete="off" />
      </Field>
      <Field label="Lote">
        <Input name="lot" maxLength={LIMITS.lot} defaultValue={item?.lot ?? ""} autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.vaccineNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <FileButtons label={item?.mime ? "Trocar comprovante (PDF ou JPG, até 4 MB)" : "Comprovante opcional (PDF ou JPG, até 4 MB)"} />
      {item?.mime && (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" name="remove_file" className="size-5 accent-[var(--primary)]" />
          Remover o comprovante atual
        </label>
      )}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : item ? "Salvar alterações" : "Salvar vacina"}</Button>
    </form>
  );
}

export function VaccinesView({ people, items, defaultMember, today }: { people: VaccinePerson[]; items: VaccineVM[]; defaultMember: string; today: string }) {
  // Abre direto no filho (se houver); "Todos" mostra a família inteira.
  const [filter, setFilter] = useState<string>(() => people.find((p) => p.child)?.id ?? "");
  const [modal, setModal] = useState<{ item?: VaccineVM } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove(id: string) {
    setPending(true);
    const r = await deleteVaccine(id);
    setPending(false);
    setError(r.ok ? null : (r.erro ?? "Não foi possível apagar."));
    setNotice(r.ok ? "Vacina apagada." : null);
  }

  const shown = filter ? items.filter((x) => x.memberId === filter) : items;
  const who = people.find((p) => p.id === filter);

  return (
    <div className="flex flex-col gap-6">
      <PushNotifications />
      <div className="flex flex-col items-start gap-3">
        <div role="group" aria-label="Filtrar por pessoa" className="-mx-5 flex max-w-full gap-2 overflow-x-auto px-5 py-1 [scrollbar-width:none] md:mx-0 md:px-0">
          <button type="button" aria-pressed={filter === ""} className={chipClass(filter === "")} onClick={() => setFilter("")}>
            Todos
          </button>
          {people.map((p) => (
            <button key={p.id} type="button" aria-pressed={filter === p.id} className={chipClass(filter === p.id)} onClick={() => setFilter(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setModal({})}>
          <Plus size={15} aria-hidden /> Nova vacina
        </Button>
      </div>
      {notice && (
        <p role="status" className="-mt-2 text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
      {shown.length === 0 && (
        <EmptyState title={who ? `Nenhuma vacina de ${who.name} ainda.` : "Nenhuma vacina ainda."}>Registre as doses aplicadas e a data da próxima.</EmptyState>
      )}
      {shown.map((x) => {
        const overdue = isOverdue(x.nextDoseOn, today);
        return (
          <Card key={x.id} data-testid="vacina">
            <p className="text-lg font-medium">
              {x.name}
              {x.dose ? ` — ${x.dose}` : ""}
            </p>
            <p className="mt-1 text-sm">
              {x.person}
              {x.appliedOn ? ` · aplicada em ${brDate(x.appliedOn)}` : ""}
            </p>
            {x.nextDoseOn && (
              <p className={overdue ? "mt-1 text-sm font-medium text-danger" : "mt-1 text-sm font-medium"}>
                Próxima dose: {brDate(x.nextDoseOn)}
                {overdue ? " (atrasada)" : ""}
              </p>
            )}
            {x.place && <p className="text-sm text-muted">{x.place}</p>}
            {x.lot && <p className="text-sm text-muted">Lote {x.lot}</p>}
            {x.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{x.notes}</p>}
            {x.mime && (
              <div className="mt-2">
                <FileLink href={`/saude/arquivo/vacinas/${x.id}`} mime={x.mime} label={`Comprovante ${x.name}`} />
                {x.size !== null && <span className="ml-2 text-xs text-muted">{formatSize(x.size)}</span>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => setModal({ item: x })}>
                Editar
              </Button>
              <ConfirmDelete what="esta vacina" pending={pending} onConfirm={() => remove(x.id)} />
            </div>
          </Card>
        );
      })}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar vacina" : "Nova vacina"}>
        <VaccineForm
          item={modal?.item}
          people={people}
          defaultMember={modal?.item?.memberId ?? (filter || defaultMember)}
          onDone={() => {
            setNotice(modal?.item ? "Vacina atualizada." : "Vacina salva.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
