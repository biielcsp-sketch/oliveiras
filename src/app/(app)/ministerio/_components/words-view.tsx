"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { IGREJA_LIMITS, type WordKind } from "@/lib/igreja/input";
import type { WithOwner, Word } from "@/lib/igreja/data";
import { deleteWord, saveWord, setPromiseFulfilled } from "../devocional-actions";
import { ActionForm, ConfirmDelete, Feedback, Multiline, ShareBadge, ShareField, smallBtn, useRunner } from "./shared";

type Item = WithOwner<Word>;

const COPY: Record<WordKind, { title: string; intro: string; add: string; empty: string; emptyHint: string; one: string; bodyLabel: string; placeholder: string }> = {
  anotacao: {
    title: "Anotações",
    intro: "Palavras que o Senhor fala comigo.",
    add: "Nova anotação",
    empty: "Nenhuma anotação ainda.",
    emptyHint: "Guarde aqui o que Deus falou com você: na oração, num culto, na leitura da Palavra.",
    one: "anotação",
    bodyLabel: "O que o Senhor falou",
    placeholder: "Escreva com as suas palavras…",
  },
  promessa: {
    title: "Promessas",
    intro: "Promessas que ouvi do Senhor.",
    add: "Nova promessa",
    empty: "Nenhuma promessa ainda.",
    emptyHint: "Anote a promessa e, quando se cumprir, marque como cumprida.",
    one: "promessa",
    bodyLabel: "A promessa",
    placeholder: "Ex.: Eu te darei uma casa…",
  },
};

function WordForm({ kind, item, today, onDone }: { kind: WordKind; item?: Item; today: string; onDone: (m?: string) => void }) {
  const c = COPY[kind];
  return (
    <ActionForm action={saveWord} onDone={onDone} submit={item ? "Salvar alterações" : `Salvar ${c.one}`} label={item ? `Editar ${c.one}` : c.add}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="kind" value={kind} />
      <Field label="Título (opcional)">
        <Input name="title" maxLength={IGREJA_LIMITS.wordTitle} defaultValue={item?.title ?? ""} autoComplete="off" />
      </Field>
      <Field label={c.bodyLabel}>
        <Textarea name="body" rows={6} maxLength={IGREJA_LIMITS.wordBody} defaultValue={item?.body ?? ""} placeholder={c.placeholder} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quando">
          <Input name="received_on" type="date" max={today} defaultValue={item?.received_on ?? today} />
        </Field>
        <Field label="Referência (opcional)">
          <Input name="reference" maxLength={IGREJA_LIMITS.reference} defaultValue={item?.reference ?? ""} placeholder="Ex.: Isaías 41:10" autoComplete="off" />
        </Field>
      </div>
      {kind === "promessa" && item && (
        <Field label="Cumprida em (opcional)">
          <Input name="fulfilled_on" type="date" defaultValue={item.fulfilled_on ?? ""} />
        </Field>
      )}
      <ShareField defaultChecked={item?.shared} />
    </ActionForm>
  );
}

function FulfillButton({ item, today, pending, onSave }: { item: Item; today: string; pending: boolean; onSave: (date: string | null) => void }) {
  const [asking, setAsking] = useState(false);
  const [date, setDate] = useState(today);
  if (item.fulfilled_on)
    return (
      <Button type="button" variant="ghost" className={smallBtn} disabled={pending} onClick={() => onSave(null)}>
        Desmarcar cumprida
      </Button>
    );
  if (!asking)
    return (
      <Button type="button" variant="ghost" className={smallBtn} onClick={() => setAsking(true)}>
        Marcar como cumprida
      </Button>
    );
  return (
    <span role="group" aria-label="Data do cumprimento" className="inline-flex flex-wrap items-center gap-2">
      <Input type="date" aria-label="Cumprida em" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="h-11 w-auto" />
      <Button type="button" className={smallBtn} disabled={pending || !date} onClick={() => onSave(date)}>
        Confirmar
      </Button>
      <Button type="button" variant="ghost" className={smallBtn} onClick={() => setAsking(false)}>
        Cancelar
      </Button>
    </span>
  );
}

export function WordsView({ kind, items, today }: { kind: WordKind; items: Item[]; today: string }) {
  const c = COPY[kind];
  const [modal, setModal] = useState<{ item?: Item } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{c.title}</h2>
          <p className="text-sm text-muted">{c.intro}</p>
        </div>
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> {c.add}
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {items.length === 0 && <EmptyState title={c.empty}>{c.emptyHint}</EmptyState>}
      {items.map((w) => (
        <Card key={w.id} data-testid={kind} aria-label={w.title ?? c.one}>
          <ShareBadge mine={w.mine} shared={w.shared} sharedBy={w.sharedBy} />
          {w.title && <p className="text-lg font-medium">{w.title}</p>}
          <Multiline text={w.body} className="mt-1 text-[15px]" />
          <p className="mt-2 text-sm text-muted">
            {brDate(w.received_on)}
            {w.reference ? ` · ${w.reference}` : ""}
          </p>
          {kind === "promessa" && (
            <p className={`mt-1 text-sm font-medium ${w.fulfilled_on ? "text-primary" : "text-muted"}`}>
              {w.fulfilled_on ? `Cumprida em ${brDate(w.fulfilled_on)}` : "Aguardando o cumprimento"}
            </p>
          )}
          {w.mine && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {kind === "promessa" && (
                <FulfillButton
                  item={w}
                  today={today}
                  pending={pending}
                  onSave={(d) => run(() => setPromiseFulfilled(w.id, d), d ? "Promessa marcada como cumprida." : "Promessa aguardando de novo.")}
                />
              )}
              <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: w })}>
                Editar
              </Button>
              <ConfirmDelete what={`esta ${c.one}`} pending={pending} onConfirm={() => run(() => deleteWord(w.id), `${c.one[0].toUpperCase()}${c.one.slice(1)} apagada.`)} />
            </div>
          )}
        </Card>
      ))}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? `Editar ${c.one}` : c.add}>
        {modal && (
          <WordForm
            kind={kind}
            item={modal.item}
            today={today}
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
