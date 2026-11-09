"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/saude/input";
import { formatSize } from "@/lib/saude/files";
import { deleteProcedure, saveProcedure, type SaudeState } from "../actions";
import { ConfirmDelete, FileLink, fileInputClass, type Person } from "./shared";

export type ProcedureVM = {
  id: string;
  memberId: string;
  person: string;
  name: string;
  date: string | null;
  place: string | null;
  doctor: string | null;
  notes: string | null;
  mime: "application/pdf" | "image/jpeg" | null;
  size: number | null;
};

function ProcedureForm({ item, people, defaultMember, onDone }: { item?: ProcedureVM; people: Person[]; defaultMember: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<SaudeState, FormData>(saveProcedure, null);
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
      <Field label="Procedimento">
        <Input name="name" maxLength={LIMITS.procName} defaultValue={item?.name} placeholder="Ex.: Endoscopia" required autoComplete="off" />
      </Field>
      <Field label="Data de realização">
        <Input name="performed_on" type="date" defaultValue={item?.date ?? ""} />
      </Field>
      <Field label="Local">
        <Input name="place" maxLength={LIMITS.place} defaultValue={item?.place ?? ""} autoComplete="off" />
      </Field>
      <Field label="Médico">
        <Input name="doctor" maxLength={LIMITS.doctor} defaultValue={item?.doctor ?? ""} autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.procNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <Field label={item?.mime ? "Trocar arquivo (PDF ou JPG, até 5 MB)" : "Arquivo opcional (PDF ou JPG, até 5 MB)"}>
        <input name="file" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" className={fileInputClass} />
      </Field>
      {item?.mime && (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" name="remove_file" className="size-5 accent-[var(--primary)]" />
          Remover o arquivo atual
        </label>
      )}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : item ? "Salvar alterações" : "Salvar procedimento"}</Button>
    </form>
  );
}

export function ProceduresView({ people, items, defaultMember }: { people: Person[]; items: ProcedureVM[]; defaultMember: string }) {
  const [modal, setModal] = useState<{ item?: ProcedureVM } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove(id: string) {
    setPending(true);
    const r = await deleteProcedure(id);
    setPending(false);
    setError(r.ok ? null : (r.erro ?? "Não foi possível apagar."));
    setNotice(r.ok ? "Procedimento apagado." : null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> Novo procedimento
        </Button>
      </div>
      {notice && (
        <p role="status" className="-mt-2 text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
      {items.length === 0 && <EmptyState title="Nenhum procedimento ainda.">Registre cirurgias e procedimentos da família, com o laudo se tiver.</EmptyState>}
      {items.map((x) => (
        <Card key={x.id} data-testid="procedimento">
          <p className="text-lg font-medium">{x.name}</p>
          <p className="mt-1 text-sm">
            {x.person}
            {x.date ? ` · ${brDate(x.date)}` : ""}
          </p>
          {x.place && <p className="text-sm text-muted">{x.place}</p>}
          {x.doctor && <p className="text-sm text-muted">{x.doctor}</p>}
          {x.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{x.notes}</p>}
          {x.mime && (
            <div className="mt-2">
              <FileLink href={`/saude/arquivo/procedimentos/${x.id}`} mime={x.mime} label={`Procedimento ${x.name}`} />
              {x.size !== null && <span className="ml-2 text-xs text-muted">{formatSize(x.size)}</span>}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => setModal({ item: x })}>
              Editar
            </Button>
            <ConfirmDelete what="este procedimento" pending={pending} onConfirm={() => remove(x.id)} />
          </div>
        </Card>
      ))}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar procedimento" : "Novo procedimento"}>
        <ProcedureForm
          item={modal?.item}
          people={people}
          defaultMember={defaultMember}
          onDone={() => {
            setNotice(modal?.item ? "Procedimento atualizado." : "Procedimento salvo.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
