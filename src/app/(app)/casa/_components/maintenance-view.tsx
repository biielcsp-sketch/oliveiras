"use client";

import { startTransition, useActionState, useState } from "react";
import { Plus } from "lucide-react";
import clsx from "clsx";
import { Button, Card, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate, diffDays } from "@/lib/agenda/dates";
import { formatBRL } from "@/lib/financas/money";
import { LIMITS } from "@/lib/casa/input";
import { intervalLabel, maintenanceStatus, sortMaintenance } from "@/lib/casa/view";
import type { IntervalUnit } from "@/lib/casa/types";
import type { ProviderContact } from "@/lib/casa/contacts";
import { deleteMaintenance, markMaintenanceDone, saveMaintenance, type CasaState } from "../actions";
import { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner } from "./shared";
import { ContactButtons } from "./contact-buttons";

export type MaintenanceVM = {
  id: string;
  name: string;
  notes: string | null;
  interval_value: number;
  interval_unit: IntervalUnit;
  last_done_on: string | null;
  next_due_on: string | null;
  provider: string | null;
  provider_id: string | null;
  contact: ProviderContact | null;
  history: { id: string; done_on: string; cost: number | null; notes: string | null }[];
};

export type ProviderOption = { id: string; name: string; service: string | null };

function MaintenanceForm({ item, providers, today, onDone }: { item?: MaintenanceVM; providers: ProviderOption[]; today: string; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<CasaState, FormData>(saveMaintenance, null);
  useOnSaved(state, onDone);
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
      <Field label="Manutenção">
        <Input name="name" maxLength={LIMITS.name} defaultValue={item?.name} placeholder="Ex.: Limpar o ar-condicionado" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="A cada">
          <Input name="interval_value" type="number" min={1} max={LIMITS.intervalMax} defaultValue={item?.interval_value ?? 6} required />
        </Field>
        <Field label="Unidade">
          <Select name="interval_unit" defaultValue={item?.interval_unit ?? "meses"}>
            <option value="dias">dias</option>
            <option value="semanas">semanas</option>
            <option value="meses">meses</option>
            <option value="anos">anos</option>
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
      <Field label="Prestador (texto livre)">
        <Input name="provider" maxLength={LIMITS.provider} defaultValue={item?.provider ?? ""} placeholder="Ex.: João Refrigeração" autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.maintNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : item ? "Salvar alterações" : "Salvar manutenção"}</Button>
    </form>
  );
}

function DoneForm({ item, today, onDone }: { item: MaintenanceVM; today: string; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<CasaState, FormData>(markMaintenanceDone, null);
  useOnSaved(state, onDone);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="id" value={item.id} />
      <Field label="Feita em">
        <Input name="done_on" type="date" max={today} defaultValue={today} required />
      </Field>
      <Field label="Custo (opcional)">
        <Input name="cost" inputMode="decimal" placeholder="Ex.: 150,00" autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.maintNotes} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : "Registrar"}</Button>
    </form>
  );
}

const statusTag = {
  vencida: { label: "Vencida", cls: "bg-danger/15 text-danger" },
  "em-breve": { label: "Em breve", cls: "bg-warning-soft text-warning" },
} as const;

export function MaintenanceView({ items, providers, today }: { items: MaintenanceVM[]; providers: ProviderOption[]; today: string }) {
  const [modal, setModal] = useState<{ kind: "edit"; item?: MaintenanceVM } | { kind: "done"; item: MaintenanceVM } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const [quick, setQuick] = useState(false);

  async function doneToday(x: MaintenanceVM) {
    const fd = new FormData();
    fd.set("id", x.id);
    fd.set("done_on", today);
    setQuick(true);
    await run(async () => {
      const r = await markMaintenanceDone(null, fd);
      return { ok: !!r?.ok, erro: r?.error };
    }, `${x.name}: registrada hoje.`);
    setQuick(false);
  }

  function row(x: MaintenanceVM) {
    const status = maintenanceStatus(x.next_due_on, today);
    const tag = status === "vencida" || status === "em-breve" ? statusTag[status] : null;
    const days = x.next_due_on ? diffDays(today, x.next_due_on) : null;
    return (
      <Card key={x.id} data-testid="manutencao" aria-label={x.name}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-lg font-medium">{x.name}</p>
          {tag && <span className={clsx("inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium", tag.cls)}>{tag.label}</span>}
        </div>
        <p className="mt-1 text-sm" data-testid="proxima">
          {x.next_due_on
            ? `Próxima: ${brDate(x.next_due_on)}${days !== null && days < 0 ? ` (há ${-days} dia${days === -1 ? "" : "s"})` : days === 0 ? " (hoje)" : ""}`
            : "Sem data: registre a primeira vez."}
        </p>
        <p className="text-sm text-muted">
          {intervalLabel(x.interval_value, x.interval_unit)}
          {x.last_done_on ? ` · última vez ${brDate(x.last_done_on)}` : ""}
        </p>
        {x.contact && (
          <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="contato-prestador">
            <p className="text-sm">
              Prestador: {x.contact.name}
              {x.contact.phone ? ` · ${x.contact.phone}` : ""}
            </p>
            <ContactButtons name={x.contact.name} tel={x.contact.tel} whatsapp={x.contact.whatsapp} />
          </div>
        )}
        {x.provider && (!x.contact || x.provider !== x.contact.name) && <p className="text-sm text-muted">Prestador: {x.provider}</p>}
        {x.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{x.notes}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" className={smallBtn} disabled={pending || quick} onClick={() => doneToday(x)}>
            Feita hoje
          </Button>
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ kind: "done", item: x })}>
            Outra data
          </Button>
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ kind: "edit", item: x })}>
            Editar
          </Button>
          <ConfirmDelete what="esta manutenção" pending={pending} onConfirm={() => run(() => deleteMaintenance(x.id), "Manutenção apagada.")} />
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
    <div className="flex flex-col gap-6">
      <div className="flex">
        <Button size="sm" onClick={() => setModal({ kind: "edit" })}>
          <Plus size={15} aria-hidden /> Nova manutenção
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {items.length === 0 ? (
        <EmptyState title="Nenhuma manutenção ainda.">Ex.: filtro de água, ar-condicionado, caixa d’água, dedetização.</EmptyState>
      ) : (
        <section aria-label="Manutenções" className="flex flex-col gap-3">
          {sortMaintenance(items).map(row)}
        </section>
      )}
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.kind === "done" ? `Registrar: ${modal.item.name}` : modal?.item ? "Editar manutenção" : "Nova manutenção"}
      >
        {modal?.kind === "done" ? (
          <DoneForm
            item={modal.item}
            today={today}
            onDone={(m) => {
              setNotice(m ?? "Manutenção registrada.");
              setModal(null);
            }}
          />
        ) : (
          <MaintenanceForm
            item={modal?.item}
            providers={providers}
            today={today}
            onDone={(m) => {
              setNotice(m ?? "Manutenção salva.");
              setModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
