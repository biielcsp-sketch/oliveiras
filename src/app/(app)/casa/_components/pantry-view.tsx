"use client";

import { startTransition, useActionState, useState } from "react";
import { Minus, Plus } from "lucide-react";
import clsx from "clsx";
import { Button, Card, EmptyState, Field, FormError, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate, diffDays } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/casa/input";
import { expiryStatus, formatQty, isLow } from "@/lib/casa/view";
import { adjustPantry, deletePantryItem, savePantryItem, type CasaState } from "../actions";
import { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner } from "./shared";

export type PantryVM = {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  unit: string | null;
  category: string | null;
  location: string | null;
  expires_on: string | null;
  notes: string | null;
};

const qtyInput = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));

function PantryForm({ item, onDone }: { item?: PantryVM; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<CasaState, FormData>(savePantryItem, null);
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
      {item && <input type="hidden" name="expected_quantity" value={String(item.quantity)} />}
      <Field label="Item">
        <Input name="name" maxLength={LIMITS.name} defaultValue={item?.name} placeholder="Ex.: Arroz" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantidade">
          <Input name="quantity" inputMode="decimal" defaultValue={qtyInput(item?.quantity)} placeholder="0" autoComplete="off" />
        </Field>
        <Field label="Mínimo">
          <Input name="min_quantity" inputMode="decimal" defaultValue={qtyInput(item?.min_quantity)} placeholder="0" autoComplete="off" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidade">
          <Input name="unit" maxLength={LIMITS.unit} defaultValue={item?.unit ?? ""} placeholder="Ex.: pacote" autoComplete="off" />
        </Field>
        <Field label="Categoria">
          <Input name="category" maxLength={LIMITS.category} defaultValue={item?.category ?? ""} placeholder="Ex.: Mercado" autoComplete="off" />
        </Field>
      </div>
      <Field label="Local">
        <Input name="location" maxLength={LIMITS.location} defaultValue={item?.location ?? ""} placeholder="Ex.: Armário da cozinha" autoComplete="off" />
      </Field>
      <Field label="Validade">
        <Input name="expires_on" type="date" defaultValue={item?.expires_on ?? ""} />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.pantryNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <p className="text-sm text-muted">Quando a quantidade chegar ao mínimo, o item vai sozinho para a lista de compras.</p>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : item ? "Salvar alterações" : "Salvar item"}</Button>
    </form>
  );
}

function badgeClass(tone: "warning" | "danger") {
  return clsx(
    "inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium",
    tone === "warning" ? "bg-warning-soft text-warning" : "bg-danger/15 text-danger",
  );
}

export function PantryView({ items, today }: { items: PantryVM[]; today: string }) {
  const [modal, setModal] = useState<{ item?: PantryVM } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const attention = items.filter((x) => isLow(x) || expiryStatus(x.expires_on, today));
  const rest = items.filter((x) => !attention.includes(x));

  function row(x: PantryVM) {
    const low = isLow(x);
    const exp = expiryStatus(x.expires_on, today);
    const days = x.expires_on ? diffDays(today, x.expires_on) : null;
    return (
      <Card key={x.id} data-testid="item-despensa" aria-label={x.name}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-medium">{x.name}</p>
            <p className="text-sm text-muted">
              Mínimo {formatQty(x.min_quantity)}
              {x.unit ? ` ${x.unit}` : ""}
              {x.location ? ` · ${x.location}` : ""}
            </p>
            {x.expires_on && <p className="text-sm text-muted">Validade {brDate(x.expires_on)}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {low && <span className={badgeClass("warning")}>{x.quantity === 0 ? "Acabou" : "Acabando"}</span>}
              {exp === "vencido" && <span className={badgeClass("danger")}>Vencido</span>}
              {exp === "vencendo" && <span className={badgeClass("warning")}>{days === 0 ? "Vence hoje" : `Vence em ${days} dia${days === 1 ? "" : "s"}`}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="size-11 px-0"
              aria-label={`Diminuir ${x.name}`}
              disabled={pending || x.quantity <= 0}
              onClick={() => run(() => adjustPantry(x.id, -1), (r) => (r.added ? `${x.name} está acabando: foi para a lista de compras.` : null))}
            >
              <Minus size={18} aria-hidden />
            </Button>
            <span className="min-w-12 text-center text-lg font-semibold tabular-nums" aria-label={`Quantidade de ${x.name}`}>
              {formatQty(x.quantity)}
            </span>
            <Button
              type="button"
              variant="ghost"
              className="size-11 px-0"
              aria-label={`Aumentar ${x.name}`}
              disabled={pending}
              onClick={() => run(() => adjustPantry(x.id, 1))}
            >
              <Plus size={18} aria-hidden />
            </Button>
          </div>
        </div>
        {x.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{x.notes}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: x })}>
            Editar
          </Button>
          <ConfirmDelete what="este item" pending={pending} onConfirm={() => run(() => deletePantryItem(x.id), "Item apagado.")} />
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> Novo item
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {items.length === 0 && <EmptyState title="A despensa está vazia.">Cadastre o que tem em casa, com o mínimo de cada item.</EmptyState>}
      {attention.length > 0 && (
        <section aria-label="Precisa de atenção" className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Acabando ou vencendo</h2>
          {attention.map(row)}
        </section>
      )}
      {rest.length > 0 && (
        <section aria-label="Em estoque" className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Em estoque</h2>
          {rest.map(row)}
        </section>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar item" : "Novo item da despensa"}>
        <PantryForm
          item={modal?.item}
          onDone={(m) => {
            setNotice(m ?? "Item salvo.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
