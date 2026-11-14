"use client";

import { startTransition, useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, FormError, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { LIMITS } from "@/lib/casa/input";
import { groupProviders } from "@/lib/casa/contacts";
import { deleteProvider, saveProvider, type ProviderState } from "../prestadores-actions";
import { ContactButtons } from "./contact-buttons";
import { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner } from "./shared";

export type ProviderVM = {
  id: string;
  name: string;
  service: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tel: string | null;
  whatsapp: string | null;
};

function ProviderForm({ item, services, onDone }: { item?: ProviderVM; services: string[]; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<ProviderState, FormData>(saveProvider, null);
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
      <Field label="Nome">
        <Input name="name" maxLength={LIMITS.providerName} defaultValue={item?.name} placeholder="Ex.: João Refrigeração" required autoComplete="off" />
      </Field>
      <Field label="Serviço">
        <Input name="service" list="casa-servicos" maxLength={LIMITS.providerService} defaultValue={item?.service ?? ""} placeholder="Ex.: Ar-condicionado" autoComplete="off" />
      </Field>
      <datalist id="casa-servicos">
        {services.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Field label="Telefone">
        <Input name="phone" type="tel" maxLength={LIMITS.providerPhone} defaultValue={item?.phone ?? ""} placeholder="Ex.: (11) 98765-4321" autoComplete="off" />
      </Field>
      <Field label="E-mail">
        <Input name="email" type="email" maxLength={LIMITS.providerEmail} defaultValue={item?.email ?? ""} autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.providerNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : item ? "Salvar alterações" : "Salvar prestador"}</Button>
    </form>
  );
}

export function ProvidersView({ items }: { items: ProviderVM[] }) {
  const [modal, setModal] = useState<{ item?: ProviderVM } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const groups = groupProviders(items);
  const services = [...new Set(items.map((p) => p.service).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex">
        <Button size="sm" onClick={() => setModal({})}>
          <Plus size={15} aria-hidden /> Novo prestador
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {items.length === 0 && <EmptyState title="Nenhum prestador ainda.">Eletricista, encanador, diarista, técnico do ar-condicionado…</EmptyState>}
      {groups.map((g) => (
        <section key={g.service} aria-label={g.service} className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{g.service}</h2>
          {g.items.map((p) => (
            <Card key={p.id} data-testid="prestador" aria-label={p.name}>
              <p className="text-lg font-medium">{p.name}</p>
              {p.phone && <p className="text-sm">{p.phone}</p>}
              {p.email && <p className="text-sm text-muted">{p.email}</p>}
              {p.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{p.notes}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ContactButtons name={p.name} tel={p.tel} whatsapp={p.whatsapp} />
                <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: p })}>
                  Editar
                </Button>
                <ConfirmDelete what="este prestador" pending={pending} onConfirm={() => run(() => deleteProvider(p.id), "Prestador apagado.")} />
              </div>
            </Card>
          ))}
        </section>
      ))}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar prestador" : "Novo prestador"}>
        {modal && (
          <ProviderForm
            item={modal.item}
            services={services}
            onDone={(m) => {
              setNotice(m ?? "Prestador salvo.");
              setModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
