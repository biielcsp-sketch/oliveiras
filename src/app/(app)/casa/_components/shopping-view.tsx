"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, FormError, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { LIMITS } from "@/lib/casa/input";
import { groupShopping, qtyLabel } from "@/lib/casa/view";
import { clearDoneShopping, deleteShoppingItem, saveShoppingItem, toggleShoppingItem, type CasaState } from "../actions";
import { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner } from "./shared";

export type ShoppingVM = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  notes: string | null;
  done: boolean;
};

function DetailFields({ item, categories }: { item?: ShoppingVM; categories: string[] }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantidade">
          <Input name="quantity" inputMode="decimal" defaultValue={item?.quantity ?? ""} placeholder="Ex.: 2" autoComplete="off" />
        </Field>
        <Field label="Unidade">
          <Input name="unit" maxLength={LIMITS.unit} defaultValue={item?.unit ?? ""} placeholder="Ex.: kg" autoComplete="off" />
        </Field>
      </div>
      <Field label="Categoria">
        <Input name="category" list="casa-categorias" maxLength={LIMITS.category} defaultValue={item?.category ?? ""} placeholder="Ex.: Mercado" autoComplete="off" />
      </Field>
      <datalist id="casa-categorias">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

/** Adicionar rápido: só o nome; quantidade, unidade e categoria ficam em "Mais detalhes". */
function QuickAdd({ categories, onSaved }: { categories: string[]; onSaved: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<CasaState, FormData>(saveShoppingItem, null);
  const [details, setDetails] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useOnSaved(state, (msg) => {
    formRef.current?.reset();
    formRef.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus();
    onSaved(msg);
  });
  return (
    <Card>
      <form
        ref={formRef}
        aria-label="Adicionar à lista"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex gap-2">
          <Input name="name" aria-label="Item" maxLength={LIMITS.name} placeholder="O que precisa comprar?" required autoComplete="off" />
          <Button disabled={pending} className="shrink-0 px-4" aria-label="Adicionar">
            <Plus size={18} aria-hidden /> <span className="max-sm:sr-only">Adicionar</span>
          </Button>
        </div>
        {details ? (
          <DetailFields categories={categories} />
        ) : (
          <button type="button" className="self-start text-sm font-medium text-link" onClick={() => setDetails(true)}>
            Mais detalhes (quantidade, categoria)
          </button>
        )}
        <FormError message={state?.error} />
      </form>
    </Card>
  );
}

function EditForm({ item, categories, onDone }: { item: ShoppingVM; categories: string[]; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<CasaState, FormData>(saveShoppingItem, null);
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
      <Field label="Item">
        <Input name="name" maxLength={LIMITS.name} defaultValue={item.name} required autoComplete="off" />
      </Field>
      <DetailFields item={item} categories={categories} />
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.shoppingNotes} defaultValue={item.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</Button>
    </form>
  );
}

export function ShoppingView({ items, categories }: { items: ShoppingVM[]; categories: string[] }) {
  const [editing, setEditing] = useState<ShoppingVM | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  // Marcação otimista por item: vale só enquanto o servidor ainda mostra o valor de antes do clique (`from`).
  const [optimistic, setOptimistic] = useState<Record<string, { from: boolean; to: boolean }>>({});
  const view = items.map((x) => {
    const o = optimistic[x.id];
    return o && o.from === x.done ? { ...x, done: o.to } : x;
  });
  const { groups, done } = groupShopping(view);

  async function toggle(x: ShoppingVM) {
    const from = items.find((i) => i.id === x.id)?.done ?? x.done;
    setOptimistic((o) => ({ ...o, [x.id]: { from, to: !x.done } }));
    const r = await run(() => toggleShoppingItem(x.id, !x.done));
    if (!r.ok)
      setOptimistic((o) => {
        const next = { ...o };
        delete next[x.id];
        return next;
      });
  }

  function row(x: ShoppingVM) {
    const qty = qtyLabel(x.quantity, x.unit);
    return (
      <li key={x.id} data-testid="item-compra" className="flex items-center gap-3 border-b border-line py-2 last:border-0">
        <input
          type="checkbox"
          checked={x.done}
          onChange={() => toggle(x)}
          aria-label={x.name}
          className="size-6 shrink-0 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <p className={x.done ? "text-muted line-through" : "font-medium"}>
            {x.name}
            {qty && <span className="font-normal text-muted"> · {qty}</span>}
          </p>
          {x.notes && <p className="whitespace-pre-wrap text-sm text-muted">{x.notes}</p>}
        </div>
        <Button type="button" variant="ghost" className={smallBtn} aria-label={`Editar ${x.name}`} onClick={() => setEditing(x)}>
          Editar
        </Button>
        <ConfirmDelete what="este item" pending={pending} onConfirm={() => run(() => deleteShoppingItem(x.id), "Item apagado.")} />
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <QuickAdd categories={categories} onSaved={(m) => setNotice(m ?? null)} />
      <Feedback notice={notice} error={error} />
      {items.length === 0 && <EmptyState title="A lista está vazia.">Adicione o que precisa comprar; os dois celulares veem a mesma lista.</EmptyState>}
      {groups.map((g) => (
        <section key={g.category} aria-label={g.category}>
          <h2 className="mb-2 text-lg font-medium">{g.category}</h2>
          <Card className="py-2">
            <ul>{g.items.map(row)}</ul>
          </Card>
        </section>
      ))}
      {done.length > 0 && (
        <section aria-label="Comprados">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Comprados</h2>
            <Button type="button" variant="ghost" className={smallBtn} disabled={pending} onClick={() => run(() => clearDoneShopping(), "Comprados removidos da lista.")}>
              Limpar comprados
            </Button>
          </div>
          <Card className="py-2">
            <ul>{done.map(row)}</ul>
          </Card>
        </section>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar item">
        {editing && (
          <EditForm
            item={editing}
            categories={categories}
            onDone={(m) => {
              setNotice(m ?? "Item atualizado.");
              setEditing(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
