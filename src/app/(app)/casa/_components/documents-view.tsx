"use client";

import { startTransition, useActionState, useState } from "react";
import { Plus } from "lucide-react";
import clsx from "clsx";
import { Button, Card, chipClass, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate, diffDays } from "@/lib/agenda/dates";
import { formatBRL } from "@/lib/financas/money";
import { formatSize } from "@/lib/saude/files";
import { LIMITS } from "@/lib/casa/input";
import { warrantyAlerts, warrantyStatus } from "@/lib/casa/docs";
import { DOC_KIND_LABEL, DOC_KINDS, type DocKind } from "@/lib/casa/types";
import { deleteCasaDocument, saveCasaDocument, type DocState } from "../documentos-actions";
import { FileLink, fileInputClass } from "../../saude/_components/shared";
import { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner } from "./shared";

export type DocumentVM = {
  id: string;
  kind: DocKind;
  title: string;
  product: string | null;
  store: string | null;
  purchase_date: string | null;
  warranty_until: string | null;
  amount: number | null;
  notes: string | null;
  mime: "application/pdf" | "image/jpeg" | null;
  size: number | null;
};

function DocumentForm({ doc, onDone }: { doc?: DocumentVM; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<DocState, FormData>(saveCasaDocument, null);
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
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <Field label="Tipo">
        <Select name="kind" defaultValue={doc?.kind ?? "garantia"}>
          {DOC_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOC_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Título">
        <Input name="title" maxLength={LIMITS.docTitle} defaultValue={doc?.title} placeholder="Ex.: Garantia da geladeira" required autoComplete="off" />
      </Field>
      <Field label="Produto">
        <Input name="product" maxLength={LIMITS.docProduct} defaultValue={doc?.product ?? ""} autoComplete="off" />
      </Field>
      <Field label="Loja">
        <Input name="store" maxLength={LIMITS.docStore} defaultValue={doc?.store ?? ""} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data da compra">
          <Input name="purchase_date" type="date" defaultValue={doc?.purchase_date ?? ""} />
        </Field>
        <Field label="Garantia até">
          <Input name="warranty_until" type="date" defaultValue={doc?.warranty_until ?? ""} />
        </Field>
      </div>
      <Field label="Valor (R$)">
        <Input name="amount" inputMode="decimal" defaultValue={doc?.amount != null ? doc.amount.toFixed(2).replace(".", ",") : ""} autoComplete="off" />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.docNotes} defaultValue={doc?.notes ?? ""} />
      </Field>
      <Field label={doc?.mime ? "Trocar arquivo (PDF ou JPG, até 5 MB)" : "Arquivo opcional (PDF ou JPG, até 5 MB)"}>
        <input name="file" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" className={fileInputClass} />
      </Field>
      {doc?.mime && (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" name="remove_file" className="size-5 accent-[var(--primary)]" />
          Remover o arquivo atual
        </label>
      )}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : doc ? "Salvar alterações" : "Salvar documento"}</Button>
    </form>
  );
}

const warrantyTag = {
  vencida: { label: "Garantia vencida", cls: "bg-danger/15 text-danger" },
  vencendo: { label: "Garantia vencendo", cls: "bg-warning-soft text-warning" },
} as const;

function warrantyLine(until: string, today: string) {
  const days = diffDays(today, until);
  if (days < 0) return `Garantia venceu em ${brDate(until)}`;
  if (days === 0) return "Garantia vence hoje";
  return `Garantia até ${brDate(until)}${days <= 30 ? ` (${days} dia${days === 1 ? "" : "s"})` : ""}`;
}

export function DocumentsView({ docs, today }: { docs: DocumentVM[]; today: string }) {
  const [modal, setModal] = useState<{ doc?: DocumentVM } | null>(null);
  const [filter, setFilter] = useState<DocKind | "todos">("todos");
  const { notice, setNotice, error, pending, run } = useRunner();
  const { soon, expired } = warrantyAlerts(docs, today);
  const shown = filter === "todos" ? docs : docs.filter((d) => d.kind === filter);

  function card(d: DocumentVM) {
    const ws = warrantyStatus(d.warranty_until, today);
    const tag = ws === "vencida" || ws === "vencendo" ? warrantyTag[ws] : null;
    return (
      <Card key={d.id} data-testid="documento" aria-label={d.title}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-medium">{d.title}</p>
            <p className="text-sm text-muted">{DOC_KIND_LABEL[d.kind]}</p>
          </div>
          {tag && <span className={clsx("inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium", tag.cls)}>{tag.label}</span>}
        </div>
        {(d.product || d.store) && <p className="mt-1 text-sm">{[d.product, d.store].filter(Boolean).join(" · ")}</p>}
        {(d.purchase_date || d.amount !== null) && (
          <p className="text-sm text-muted">
            {[d.purchase_date ? `Compra em ${brDate(d.purchase_date)}` : null, d.amount !== null ? formatBRL(d.amount) : null].filter(Boolean).join(" · ")}
          </p>
        )}
        {d.warranty_until && <p className="text-sm" data-testid="garantia">{warrantyLine(d.warranty_until, today)}</p>}
        {d.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{d.notes}</p>}
        {d.mime && (
          <p className="mt-1 text-sm text-muted">
            <FileLink href={`/casa/documentos/${d.id}/arquivo`} mime={d.mime} label={d.title} />
            {d.size ? ` · ${formatSize(d.size)}` : ""}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ doc: d })}>
            Editar
          </Button>
          <ConfirmDelete what="este documento" pending={pending} onConfirm={() => run(() => deleteCasaDocument(d.id), "Documento apagado.")} />
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> Novo documento
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {(soon.length > 0 || expired.length > 0) && (
        <Card tone="hero" role="region" aria-label="Garantias em destaque">
          <p className="font-medium">Garantias em destaque</p>
          <ul className="mt-1 text-sm">
            {soon.map((d) => (
              <li key={d.id}>
                {d.title}: {warrantyLine(d.warranty_until!, today)}
              </li>
            ))}
            {expired.map((d) => (
              <li key={d.id} className="text-muted">
                {d.title}: {warrantyLine(d.warranty_until!, today)}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {docs.length > 0 && (
        <div role="group" aria-label="Filtrar por tipo" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {(["todos", ...DOC_KINDS] as const).map((k) => (
            <button key={k} type="button" aria-pressed={filter === k} className={chipClass(filter === k)} onClick={() => setFilter(k)}>
              {k === "todos" ? "Todos" : DOC_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {docs.length === 0 ? (
        <EmptyState title="Nenhum documento ainda.">Guarde garantias, notas fiscais, manuais e contratos da casa.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="Nenhum documento deste tipo." />
      ) : (
        <section aria-label="Documentos" className="flex flex-col gap-3">
          {shown.map(card)}
        </section>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.doc ? "Editar documento" : "Novo documento"}>
        {modal && (
          <DocumentForm
            doc={modal.doc}
            onDone={(m) => {
              setNotice(m ?? "Documento salvo.");
              setModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
