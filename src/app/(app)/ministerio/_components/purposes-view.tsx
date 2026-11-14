"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { IGREJA_LIMITS, PURPOSE_STATUS_LABEL, PURPOSE_STATUSES, type PurposeStatus } from "@/lib/igreja/input";
import type { Purpose, WithOwner } from "@/lib/igreja/data";
import { deletePurpose, savePurpose } from "../devocional-actions";
import { ActionForm, ConfirmDelete, Feedback, Multiline, ShareBadge, ShareField, smallBtn, useRunner } from "./shared";

type Item = WithOwner<Purpose>;
const ORDER: PurposeStatus[] = ["em_andamento", "planejado", "concluido"];

function PurposeForm({ item, onDone }: { item?: Item; onDone: (m?: string) => void }) {
  return (
    <ActionForm action={savePurpose} onDone={onDone} submit={item ? "Salvar alterações" : "Salvar propósito"} label={item ? "Editar propósito" : "Novo propósito"}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Propósito">
        <Input name="title" maxLength={IGREJA_LIMITS.purposeTitle} defaultValue={item?.title} placeholder="Ex.: Jejum de Daniel" required autoComplete="off" />
      </Field>
      <Field label="Descrição (opcional)">
        <Textarea name="description" rows={3} maxLength={IGREJA_LIMITS.purposeDescription} defaultValue={item?.description ?? ""} />
      </Field>
      <Field label="Situação">
        <Select name="status" defaultValue={item?.status ?? "planejado"}>
          {PURPOSE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PURPOSE_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início">
          <Input name="starts_on" type="date" defaultValue={item?.starts_on ?? ""} />
        </Field>
        <Field label="Término">
          <Input name="ends_on" type="date" defaultValue={item?.ends_on ?? ""} />
        </Field>
      </div>
      <Field label="Anotações (opcional)">
        <Textarea name="notes" rows={3} maxLength={IGREJA_LIMITS.purposeNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <ShareField defaultChecked={item?.shared} />
    </ActionForm>
  );
}

export function PurposesView({ items }: { items: Item[] }) {
  const [modal, setModal] = useState<{ item?: Item } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Propósitos</h2>
          <p className="text-sm text-muted">Propósitos em que participo ou vou começar.</p>
        </div>
        <Button size="sm" onClick={() => setModal({})}>
          <Plus size={15} aria-hidden /> Novo propósito
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {items.length === 0 && <EmptyState title="Nenhum propósito ainda.">Jejum, campanha de oração, leitura da Bíblia em um ano…</EmptyState>}
      {ORDER.map((status) => {
        const list = items.filter((p) => p.status === status);
        if (!list.length) return null;
        return (
          <section key={status} aria-label={PURPOSE_STATUS_LABEL[status]} className="flex flex-col gap-3">
            <h3 className="text-lg font-medium">{PURPOSE_STATUS_LABEL[status]}</h3>
            {list.map((p) => (
              <Card key={p.id} data-testid="proposito" aria-label={p.title}>
                <ShareBadge mine={p.mine} shared={p.shared} sharedBy={p.sharedBy} />
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg font-medium">{p.title}</p>
                  {status === "em_andamento" && <Tag tone="info">Em andamento</Tag>}
                </div>
                {p.description && <Multiline text={p.description} className="mt-1 text-sm" />}
                {(p.starts_on || p.ends_on) && (
                  <p className="mt-2 text-sm text-muted">
                    {p.starts_on ? `De ${brDate(p.starts_on)}` : ""}
                    {p.starts_on && p.ends_on ? " " : ""}
                    {p.ends_on ? `${p.starts_on ? "a" : "Até"} ${brDate(p.ends_on)}` : ""}
                  </p>
                )}
                {p.notes && <Multiline text={p.notes} className="mt-1 text-sm text-muted" />}
                {p.mine && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: p })}>
                      Editar
                    </Button>
                    <ConfirmDelete what="este propósito" pending={pending} onConfirm={() => run(() => deletePurpose(p.id), "Propósito apagado.")} />
                  </div>
                )}
              </Card>
            ))}
          </section>
        );
      })}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar propósito" : "Novo propósito"}>
        {modal && (
          <PurposeForm
            item={modal.item}
            onDone={(m) => {
              setNotice(m ?? "Salvo.");
              setModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
