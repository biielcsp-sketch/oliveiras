"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate, diffDays } from "@/lib/agenda/dates";
import { formatBRL } from "@/lib/financas/money";
import { PET_LIMITS } from "@/lib/casa/pet-input";
import { intervalLabel, maintenanceStatus, sortMaintenance } from "@/lib/casa/view";
import type { ProviderContact } from "@/lib/casa/contacts";
import type { PetCare } from "@/lib/casa/pet";
import { deletePetCare, markPetCareDone, savePetCare } from "../pet-actions";
import { ConfirmDelete, Feedback, smallBtn, useRunner } from "./shared";
import { ContactButtons } from "./contact-buttons";
import { ActionForm, StatusTag } from "./pet-shared";
import type { ProviderOption } from "./maintenance-view";

export type CareVM = PetCare & { contact: ProviderContact | null; history: { id: string; done_on: string; cost: number | null; notes: string | null }[] };

function CareForm({ petId, item, providers, today, onDone }: { petId: string; item?: CareVM; providers: ProviderOption[]; today: string; onDone: (msg?: string) => void }) {
  return (
    <ActionForm action={savePetCare} onDone={onDone} submit={item ? "Salvar alterações" : "Salvar cuidado"}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="pet_id" value={petId} />
      <Field label="Cuidado">
        <Input name="name" maxLength={PET_LIMITS.careName} defaultValue={item?.name} placeholder="Ex.: Banho, tosa, cortar as unhas" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="A cada">
          <Input name="interval_value" type="number" min={1} max={PET_LIMITS.intervalMax} defaultValue={item?.interval_value ?? 15} required />
        </Field>
        <Field label="Unidade">
          <Select name="interval_unit" defaultValue={item?.interval_unit ?? "dias"}>
            <option value="dias">dias</option>
            <option value="semanas">semanas</option>
            <option value="meses">meses</option>
          </Select>
        </Field>
      </div>
      <Field label="Última vez feita">
        <Input name="last_done_on" type="date" max={today} defaultValue={item?.last_done_on ?? ""} />
      </Field>
      {providers.length > 0 && (
        <Field label="Prestador cadastrado">
          <Select name="provider_id" defaultValue={item?.provider_id ?? ""}>
            <option value="">Nenhum</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.service ? `${p.name} (${p.service})` : p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Observações">
        <Textarea name="notes" maxLength={PET_LIMITS.careNotes} defaultValue={item?.notes ?? ""} />
      </Field>
    </ActionForm>
  );
}

/** Estado mostrado na tela: o servidor só grava se ninguém registrou antes (update condicional). */
function ExpectedFields({ item }: { item: CareVM }) {
  return (
    <>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="expected_last" value={item.last_done_on ?? ""} />
      <input type="hidden" name="expected_next" value={item.next_due_on ?? ""} />
    </>
  );
}

function DoneForm({ item, today, onDone }: { item: CareVM; today: string; onDone: (msg?: string) => void }) {
  return (
    <ActionForm action={markPetCareDone} onDone={onDone} submit="Registrar">
      <ExpectedFields item={item} />
      <Field label="Feito em">
        <Input name="done_on" type="date" max={today} defaultValue={today} required />
      </Field>
      <Field label="Custo (opcional)">
        <Input name="cost" inputMode="decimal" placeholder="Ex.: 70,00" autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={PET_LIMITS.careNotes} />
      </Field>
    </ActionForm>
  );
}

const statusTag = {
  vencida: { label: "Vencido", tone: "danger" },
  "em-breve": { label: "Em breve", tone: "warning" },
} as const;

/** Banho, tosa, unhas…: mesmo esquema da Manutenção (intervalo, "Feito" com data e custo, histórico). */
export function PetCareSection({ petId, items, providers, today }: { petId: string; items: CareVM[]; providers: ProviderOption[]; today: string }) {
  const [modal, setModal] = useState<{ kind: "edit"; item?: CareVM } | { kind: "done"; item: CareVM } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();

  async function doneToday(x: CareVM) {
    const fd = new FormData();
    fd.set("id", x.id);
    fd.set("expected_last", x.last_done_on ?? "");
    fd.set("expected_next", x.next_due_on ?? "");
    fd.set("done_on", today);
    await run(async () => {
      const r = await markPetCareDone(null, fd);
      return { ok: !!r?.ok, erro: r?.error };
    }, `${x.name}: registrado hoje.`);
  }

  function row(x: CareVM) {
    const status = maintenanceStatus(x.next_due_on, today);
    const tag = status === "vencida" || status === "em-breve" ? statusTag[status] : null;
    const days = x.next_due_on ? diffDays(today, x.next_due_on) : null;
    return (
      <Card key={x.id} data-testid="pet-cuidado" aria-label={x.name}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-lg font-medium">{x.name}</p>
          {tag && <StatusTag tone={tag.tone}>{tag.label}</StatusTag>}
        </div>
        <p className="mt-1 text-sm" data-testid="proxima">
          {x.next_due_on
            ? `Próximo: ${brDate(x.next_due_on)}${days !== null && days < 0 ? ` (há ${-days} dia${days === -1 ? "" : "s"})` : days === 0 ? " (hoje)" : ""}`
            : "Sem data: registre a primeira vez."}
        </p>
        <p className="text-sm text-muted">
          {intervalLabel(x.interval_value, x.interval_unit)}
          {x.last_done_on ? ` · última vez ${brDate(x.last_done_on)}` : ""}
        </p>
        {x.contact && (
          <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="contato-prestador">
            <p className="text-sm">
              {x.contact.name}
              {x.contact.phone ? ` · ${x.contact.phone}` : ""}
            </p>
            <ContactButtons name={x.contact.name} tel={x.contact.tel} whatsapp={x.contact.whatsapp} />
          </div>
        )}
        {x.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{x.notes}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" className={smallBtn} disabled={pending} onClick={() => doneToday(x)}>
            Feito hoje
          </Button>
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ kind: "done", item: x })}>
            Outra data
          </Button>
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ kind: "edit", item: x })}>
            Editar
          </Button>
          <ConfirmDelete what="este cuidado" pending={pending} onConfirm={() => run(() => deletePetCare(x.id), "Cuidado apagado.")} />
        </div>
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-link">Histórico</summary>
          {x.history.length === 0 ? (
            <p className="text-sm text-muted">Nenhum registro.</p>
          ) : (
            <ul className="text-sm text-muted">
              {x.history.map((h) => (
                <li key={h.id}>
                  {brDate(h.done_on)}
                  {h.cost !== null ? ` · ${formatBRL(h.cost)}` : ""}
                  {h.notes ? ` · ${h.notes}` : ""}
                </li>
              ))}
            </ul>
          )}
        </details>
      </Card>
    );
  }

  return (
    <section aria-label="Cuidados" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Cuidados</h2>
        <Button type="button" className={smallBtn} onClick={() => setModal({ kind: "edit" })}>
          <Plus size={16} aria-hidden /> Novo cuidado
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nenhum cuidado recorrente. Ex.: banho a cada 15 dias, tosa a cada 2 meses.</p>
        </Card>
      ) : (
        sortMaintenance(items).map(row)
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.kind === "done" ? `Registrar: ${modal.item.name}` : modal?.item ? "Editar cuidado" : "Novo cuidado"}>
        {modal?.kind === "done" ? (
          <DoneForm
            item={modal.item}
            today={today}
            onDone={(m) => {
              setNotice(m ?? "Cuidado registrado.");
              setModal(null);
            }}
          />
        ) : modal ? (
          <CareForm
            petId={petId}
            item={modal.item}
            providers={providers}
            today={today}
            onDone={(m) => {
              setNotice(m ?? "Cuidado salvo.");
              setModal(null);
            }}
          />
        ) : null}
      </Modal>
    </section>
  );
}
