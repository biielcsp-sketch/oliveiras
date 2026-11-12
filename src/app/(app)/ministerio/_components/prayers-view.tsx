"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, chipClass, EmptyState, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { IGREJA_LIMITS } from "@/lib/igreja/input";
import type { Prayer, WithOwner } from "@/lib/igreja/data";
import { answerPrayer, deletePrayer, savePrayer } from "../devocional-actions";
import { ActionForm, ConfirmDelete, Feedback, Multiline, ShareBadge, ShareField, smallBtn, useRunner } from "./shared";

type Item = WithOwner<Prayer>;
type Filter = "orando" | "respondida";

function PrayerForm({ item, onDone }: { item?: Item; onDone: (m?: string) => void }) {
  return (
    <ActionForm action={savePrayer} onDone={onDone} submit={item ? "Salvar alterações" : "Salvar oração"} label={item ? "Editar oração" : "Nova oração"}>
      {item && <input type="hidden" name="id" value={item.id} />}
      {item && <input type="hidden" name="status" value={item.status} />}
      {item?.status === "respondida" && (
        <>
          <input type="hidden" name="answered_on" value={item.answered_on ?? ""} />
          <input type="hidden" name="answer_notes" value={item.answer_notes ?? ""} />
        </>
      )}
      <Field label="Motivo da oração">
        <Input name="title" maxLength={IGREJA_LIMITS.prayerTitle} defaultValue={item?.title} placeholder="Ex.: Saúde da minha mãe" required autoComplete="off" />
      </Field>
      <Field label="Por quem (opcional)">
        <Input name="person" maxLength={IGREJA_LIMITS.person} defaultValue={item?.person ?? ""} placeholder="Ex.: Dona Maria" autoComplete="off" />
      </Field>
      <Field label="Detalhes (opcional)">
        <Textarea name="details" rows={4} maxLength={IGREJA_LIMITS.prayerDetails} defaultValue={item?.details ?? ""} />
      </Field>
      <ShareField defaultChecked={item?.shared} />
    </ActionForm>
  );
}

function AnswerForm({ today, pending, onSave, onCancel }: { today: string; pending: boolean; onSave: (date: string, notes: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  return (
    <div role="group" aria-label="Oração respondida" className="mt-3 flex flex-col gap-3">
      <Field label="Respondida em">
        <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Testemunho (opcional)">
        <Textarea rows={3} maxLength={IGREJA_LIMITS.answerNotes} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Como Deus respondeu?" />
      </Field>
      <div className="flex gap-2">
        <Button type="button" className={smallBtn} disabled={pending || !date} onClick={() => onSave(date, notes)}>
          Confirmar resposta
        </Button>
        <Button type="button" variant="ghost" className={smallBtn} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function PrayersView({ items, today }: { items: Item[]; today: string }) {
  const [filter, setFilter] = useState<Filter>("orando");
  const [modal, setModal] = useState<{ item?: Item } | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const shown = items.filter((p) => p.status === filter);
  const count = (s: Filter) => items.filter((p) => p.status === s).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Orações</h2>
          <p className="text-sm text-muted">Orações e pessoas por quem orar.</p>
        </div>
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> Nova oração
        </Button>
      </div>
      <div role="group" aria-label="Filtrar orações" className="flex gap-2">
        <button type="button" className={chipClass(filter === "orando")} aria-pressed={filter === "orando"} onClick={() => setFilter("orando")}>
          Orando ({count("orando")})
        </button>
        <button type="button" className={chipClass(filter === "respondida")} aria-pressed={filter === "respondida"} onClick={() => setFilter("respondida")}>
          Respondidas ({count("respondida")})
        </button>
      </div>
      <Feedback notice={notice} error={error} />
      {shown.length === 0 && (
        <EmptyState title={filter === "orando" ? "Nenhuma oração em andamento." : "Nenhuma oração respondida ainda."}>
          {filter === "orando" ? "Anote os motivos e as pessoas por quem você está orando." : "Quando Deus responder, marque a oração e registre o testemunho."}
        </EmptyState>
      )}
      {shown.map((p) => (
        <Card key={p.id} data-testid="oracao" aria-label={p.title}>
          <ShareBadge mine={p.mine} shared={p.shared} sharedBy={p.sharedBy} />
          <p className="text-lg font-medium">{p.title}</p>
          {p.person && <p className="text-sm">Por: {p.person}</p>}
          {p.details && <Multiline text={p.details} className="mt-1 text-sm" />}
          {p.status === "respondida" && (
            <div className="mt-2 rounded-2xl bg-accent-soft p-3">
              <p className="text-sm font-medium text-primary">Respondida{p.answered_on ? ` em ${brDate(p.answered_on)}` : ""}</p>
              {p.answer_notes && <Multiline text={p.answer_notes} className="mt-1 text-sm" />}
            </div>
          )}
          {p.mine && answering === p.id && (
            <AnswerForm
              today={today}
              pending={pending}
              onCancel={() => setAnswering(null)}
              onSave={async (date, notes) => {
                const r = await run(() => answerPrayer(p.id, { date, notes }), "Glória a Deus! Oração marcada como respondida.");
                if (r.ok) setAnswering(null);
              }}
            />
          )}
          {p.mine && answering !== p.id && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {p.status === "orando" ? (
                <Button type="button" variant="ghost" className={smallBtn} onClick={() => setAnswering(p.id)}>
                  Marcar como respondida
                </Button>
              ) : (
                <Button type="button" variant="ghost" className={smallBtn} disabled={pending} onClick={() => run(() => answerPrayer(p.id, null), "Oração de volta para “orando”.")}>
                  Voltar para orando
                </Button>
              )}
              <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: p })}>
                Editar
              </Button>
              <ConfirmDelete what="esta oração" pending={pending} onConfirm={() => run(() => deletePrayer(p.id), "Oração apagada.")} />
            </div>
          )}
        </Card>
      ))}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar oração" : "Nova oração"}>
        {modal && (
          <PrayerForm
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
