"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { formatSize } from "@/lib/saude/files";
import { PET_LIMITS } from "@/lib/casa/pet-input";
import { currentHealthIds, doseAlerts, doseStatus, doseWhen, groupHealth, PET_HEALTH_GROUP, PET_HEALTH_KINDS, PET_HEALTH_LABEL, petFileHref, type PetHealth } from "@/lib/casa/pet";
import { deletePetHealth, savePetHealth } from "../pet-actions";
import { FileLink } from "../../saude/_components/shared";
import { ConfirmDelete, Feedback, smallBtn, useRunner } from "./shared";
import { ActionForm, FileFields, StatusTag } from "./pet-shared";

function HealthForm({ petId, item, onDone }: { petId: string; item?: PetHealth; onDone: (msg?: string) => void }) {
  return (
    <ActionForm action={savePetHealth} onDone={onDone} submit={item ? "Salvar alterações" : "Salvar"}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="pet_id" value={petId} />
      <Field label="Tipo">
        <Select name="kind" defaultValue={item?.kind ?? "vacina"}>
          {PET_HEALTH_KINDS.map((k) => (
            <option key={k} value={k}>
              {PET_HEALTH_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nome">
        <Input name="name" maxLength={PET_LIMITS.healthName} defaultValue={item?.name} placeholder="Ex.: V10, antirrábica, Bravecto" required autoComplete="off" />
      </Field>
      <Field label="Dose">
        <Input name="dose" maxLength={PET_LIMITS.dose} defaultValue={item?.dose ?? ""} placeholder="Ex.: 1ª dose, reforço, 1 comprimido" autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Aplicada em">
          <Input name="applied_on" type="date" defaultValue={item?.applied_on ?? ""} />
        </Field>
        <Field label="Próxima dose">
          <Input name="next_due_on" type="date" defaultValue={item?.next_due_on ?? ""} />
        </Field>
      </div>
      <Field label="Observações">
        <Textarea name="notes" maxLength={PET_LIMITS.healthNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <FileFields hasFile={!!item?.file_mime} />
    </ActionForm>
  );
}

const statusTag = {
  atrasada: { label: "Atrasada", tone: "danger" },
  hoje: { label: "Hoje", tone: "warning" },
  "em-breve": { label: "Em breve", tone: "warning" },
} as const;

/** Vacinas, vermífugos, antipulgas e remédios do pet, por tipo, com a próxima dose em destaque. */
export function PetHealthSection({ petId, petName, items, today }: { petId: string; petName: string; items: PetHealth[]; today: string }) {
  const [modal, setModal] = useState<{ item?: PetHealth } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  // Só o registro mais recente de cada vacina/remédio vale para a próxima dose; os anteriores são histórico.
  const current = currentHealthIds(items);
  const alerts = doseAlerts(items.filter((h) => current.has(h.id)), today);

  function row(h: PetHealth) {
    const isCurrent = current.has(h.id);
    const s = isCurrent ? doseStatus(h.next_due_on, today) : null;
    const tag = s && s !== "em-dia" ? statusTag[s] : null;
    return (
      <li key={h.id} data-testid="pet-saude" aria-label={h.name} className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">
              {h.name}
              {h.dose ? <span className="text-muted"> · {h.dose}</span> : null}
            </p>
            {h.applied_on && <p className="text-sm text-muted">Aplicada em {brDate(h.applied_on)}</p>}
            {!isCurrent && (
              <p className="text-sm text-muted" data-testid="dose-anterior">
                Dose anterior (há um registro mais recente)
              </p>
            )}
            {isCurrent && h.next_due_on && (
              <p className="text-sm" data-testid="proxima-dose">
                Próxima: {brDate(h.next_due_on)} ({doseWhen(h.next_due_on, today, brDate)})
              </p>
            )}
            {h.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{h.notes}</p>}
            {h.file_mime && (
              <p className="text-sm text-muted">
                <FileLink href={petFileHref("saude", h.id)} mime={h.file_mime} label={h.name} />
                {h.file_size ? ` · ${formatSize(h.file_size)}` : ""}
              </p>
            )}
          </div>
          {tag && <StatusTag tone={tag.tone}>{tag.label}</StatusTag>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: h })}>
            Editar
          </Button>
          <ConfirmDelete what="este registro" pending={pending} onConfirm={() => run(() => deletePetHealth(h.id), "Registro apagado.")} />
        </div>
      </li>
    );
  }

  return (
    <section aria-label="Vacinas e remédios" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Vacinas e remédios</h2>
        <Button type="button" className={smallBtn} onClick={() => setModal({})}>
          <Plus size={16} aria-hidden /> Novo
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {alerts.length > 0 && (
        <Card tone="hero" role="region" aria-label="Próximas doses em destaque">
          <p className="font-medium">Próximas doses de {petName}</p>
          <ul className="mt-1 text-sm">
            {alerts.map((h) => (
              <li key={h.id}>
                {PET_HEALTH_LABEL[h.kind]} {h.name}
                {h.dose ? ` - ${h.dose}` : ""}: {doseWhen(h.next_due_on!, today, brDate)}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nenhuma vacina ou remédio registrado.</p>
        </Card>
      ) : (
        groupHealth(items, current).map((g) => (
          <Card key={g.kind} role="region" aria-label={PET_HEALTH_GROUP[g.kind]}>
            <h3 className="font-medium">{PET_HEALTH_GROUP[g.kind]}</h3>
            <ul className="divide-y divide-line">{g.items.map(row)}</ul>
          </Card>
        ))
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar vacina ou remédio" : "Nova vacina ou remédio"}>
        {modal && (
          <HealthForm
            petId={petId}
            item={modal.item}
            onDone={(m) => {
              setNotice(m ?? "Salvo.");
              setModal(null);
            }}
          />
        )}
      </Modal>
    </section>
  );
}
