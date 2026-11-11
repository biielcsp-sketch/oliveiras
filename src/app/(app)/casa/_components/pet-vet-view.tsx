"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { formatBRL } from "@/lib/financas/money";
import { formatSize } from "@/lib/saude/files";
import { PET_LIMITS } from "@/lib/casa/pet-input";
import { PET_VET_KINDS, PET_VET_LABEL, petFileHref, type PetVet } from "@/lib/casa/pet";
import { deletePetVet, savePetVet } from "../pet-actions";
import { FileLink } from "../../saude/_components/shared";
import { ConfirmDelete, Feedback, smallBtn, useRunner } from "./shared";
import { ActionForm, brlInput, FileFields } from "./pet-shared";

function VetForm({ petId, item, today, onDone }: { petId: string; item?: PetVet; today: string; onDone: (msg?: string) => void }) {
  return (
    <ActionForm action={savePetVet} onDone={onDone} submit={item ? "Salvar alterações" : "Salvar registro"}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="pet_id" value={petId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select name="kind" defaultValue={item?.kind ?? "consulta"}>
            {PET_VET_KINDS.map((k) => (
              <option key={k} value={k}>
                {PET_VET_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data">
          <Input name="happened_on" type="date" defaultValue={item?.happened_on ?? today} required />
        </Field>
      </div>
      <Field label="Clínica">
        <Input name="clinic" maxLength={PET_LIMITS.clinic} defaultValue={item?.clinic ?? ""} autoComplete="off" />
      </Field>
      <Field label="Veterinário">
        <Input name="vet" maxLength={PET_LIMITS.vet} defaultValue={item?.vet ?? ""} autoComplete="off" />
      </Field>
      <Field label="Motivo">
        <Input name="reason" maxLength={PET_LIMITS.reason} defaultValue={item?.reason ?? ""} placeholder="Ex.: check-up anual, coceira" autoComplete="off" />
      </Field>
      <Field label="Custo (opcional)">
        <Input name="cost" inputMode="decimal" defaultValue={brlInput(item?.cost ?? null)} placeholder="Ex.: 180,00" autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" rows={4} maxLength={PET_LIMITS.vetNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <FileFields hasFile={!!item?.file_mime} />
    </ActionForm>
  );
}

/** Consultas, exames e receitas do pet (mais recentes primeiro). */
export function PetVetSection({ petId, items, today }: { petId: string; items: PetVet[]; today: string }) {
  const [modal, setModal] = useState<{ item?: PetVet } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();

  return (
    <section aria-label="Veterinário" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Veterinário</h2>
        <Button type="button" className={smallBtn} onClick={() => setModal({})}>
          <Plus size={16} aria-hidden /> Novo registro
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nenhuma consulta, exame ou receita registrada.</p>
        </Card>
      ) : (
        items.map((v) => (
          <Card key={v.id} data-testid="pet-vet" aria-label={`${PET_VET_LABEL[v.kind]} de ${brDate(v.happened_on)}`}>
            <p className="font-medium">
              {PET_VET_LABEL[v.kind]} · {brDate(v.happened_on)}
            </p>
            {v.reason && <p className="text-sm">{v.reason}</p>}
            {(v.clinic || v.vet || v.cost !== null) && (
              <p className="text-sm text-muted">{[v.clinic, v.vet, v.cost !== null ? formatBRL(v.cost) : null].filter(Boolean).join(" · ")}</p>
            )}
            {v.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{v.notes}</p>}
            {v.file_mime && (
              <p className="text-sm text-muted">
                <FileLink href={petFileHref("veterinario", v.id)} mime={v.file_mime} label={PET_VET_LABEL[v.kind]} />
                {v.file_size ? ` · ${formatSize(v.file_size)}` : ""}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: v })}>
                Editar
              </Button>
              <ConfirmDelete what="este registro" pending={pending} onConfirm={() => run(() => deletePetVet(v.id), "Registro apagado.")} />
            </div>
          </Card>
        ))
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar registro do veterinário" : "Novo registro do veterinário"}>
        {modal && (
          <VetForm
            petId={petId}
            item={modal.item}
            today={today}
            onDone={(m) => {
              setNotice(m ?? "Registro salvo.");
              setModal(null);
            }}
          />
        )}
      </Modal>
    </section>
  );
}
