"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { FileButtons } from "@/components/file-buttons";
import { Button, Card, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/saude/input";
import { formatSize } from "@/lib/saude/files";
import { deleteCard, saveCard, type SaudeState } from "../actions";
import { ConfirmDelete, FileLink, type Person } from "./shared";

export type CardVM = {
  id: string;
  memberId: string;
  operator: string;
  number: string | null;
  plan: string | null;
  validUntil: string | null;
  notes: string | null;
  mime: "application/pdf" | "image/jpeg";
  size: number;
};

function CardForm({ card, people, defaultMember, onDone }: { card?: CardVM; people: Person[]; defaultMember: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<SaudeState, FormData>(saveCard, null);
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
      {card && <input type="hidden" name="id" value={card.id} />}
      <Field label="Pessoa">
        <Select name="member_id" defaultValue={card?.memberId ?? defaultMember} required>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Operadora">
        <Input name="operator" maxLength={LIMITS.operator} defaultValue={card?.operator} placeholder="Ex.: Unimed" required autoComplete="off" />
      </Field>
      <Field label="Número da carteirinha">
        <Input name="card_number" maxLength={LIMITS.cardNumber} defaultValue={card?.number ?? ""} inputMode="numeric" autoComplete="off" />
      </Field>
      <Field label="Plano">
        <Input name="plan_name" maxLength={LIMITS.plan} defaultValue={card?.plan ?? ""} autoComplete="off" />
      </Field>
      <Field label="Validade">
        <Input name="valid_until" type="date" defaultValue={card?.validUntil ?? ""} />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.cardNotes} defaultValue={card?.notes ?? ""} />
      </Field>
      <FileButtons label={card ? "Trocar arquivo (PDF ou JPG, até 4 MB)" : "Arquivo (PDF ou JPG, até 4 MB)"} required={!card} />
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : card ? "Salvar alterações" : "Salvar carteirinha"}</Button>
    </form>
  );
}

export function CardsView({ people, cards, defaultMember }: { people: Person[]; cards: CardVM[]; defaultMember: string }) {
  const [modal, setModal] = useState<{ card?: CardVM } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove(id: string) {
    setPending(true);
    const r = await deleteCard(id);
    setPending(false);
    setError(r.ok ? null : (r.erro ?? "Não foi possível remover."));
    setNotice(r.ok ? "Carteirinha removida." : null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Disponíveis offline neste aparelho depois de abrir esta tela com internet.</p>
        <Button onClick={() => setModal({})} className="shrink-0">
          <Plus size={18} aria-hidden /> Nova carteirinha
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
      {cards.length === 0 && <EmptyState title="Nenhuma carteirinha ainda.">Cadastre o plano de saúde de cada pessoa da família.</EmptyState>}
      {people.map((p) => {
        const mine = cards.filter((c) => c.memberId === p.id);
        if (!mine.length) return null;
        return (
          <section key={p.id} aria-label={`Carteirinhas de ${p.name}`} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{p.name}</h2>
            {mine.map((c) => (
              <Card key={c.id} data-testid="carteirinha">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-medium">{c.operator}</p>
                    {c.number && <p className="mt-1 font-mono text-[15px] tracking-wide">{c.number}</p>}
                    {c.plan && <p className="mt-1 text-sm text-muted">{c.plan}</p>}
                    {c.validUntil && <p className="text-sm text-muted">Validade {brDate(c.validUntil)}</p>}
                    {c.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{c.notes}</p>}
                  </div>
                </div>
                <FileLink href={`/saude/arquivo/carteirinhas/${c.id}`} mime={c.mime} label={`Carteirinha ${c.operator} de ${p.name}`} preview />
                <p className="mt-1 text-xs text-muted">{c.mime === "application/pdf" ? "PDF" : "JPG"} · {formatSize(c.size)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => setModal({ card: c })}>
                    Editar
                  </Button>
                  <ConfirmDelete label="Remover" what="esta carteirinha" pending={pending} onConfirm={() => remove(c.id)} />
                </div>
              </Card>
            ))}
          </section>
        );
      })}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.card ? "Editar carteirinha" : "Nova carteirinha"}>
        <CardForm
          card={modal?.card}
          people={people}
          defaultMember={defaultMember}
          onDone={() => {
            setNotice(modal?.card ? "Carteirinha atualizada." : "Carteirinha salva.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
