"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { FileButtons } from "@/components/file-buttons";
import { Button, Card, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/saude/input";
import { formatSize } from "@/lib/saude/files";
import { deleteExam, saveExam, type SaudeState } from "../actions";
import { ConfirmDelete, FileLink, type Person } from "./shared";

export type ExamVM = {
  id: string;
  memberId: string;
  person: string;
  name: string;
  date: string | null;
  lab: string | null;
  requestedBy: string | null;
  summary: string | null;
  mime: "application/pdf" | "image/jpeg" | null;
  size: number | null;
};

function ExamForm({ exam, people, defaultMember, onDone }: { exam?: ExamVM; people: Person[]; defaultMember: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<SaudeState, FormData>(saveExam, null);
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
      {exam && <input type="hidden" name="id" value={exam.id} />}
      <Field label="Pessoa">
        <Select name="member_id" defaultValue={exam?.memberId ?? defaultMember} required>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Exame">
        <Input name="name" maxLength={LIMITS.examName} defaultValue={exam?.name} placeholder="Ex.: Hemograma completo" required autoComplete="off" />
      </Field>
      <Field label="Data">
        <Input name="exam_date" type="date" defaultValue={exam?.date ?? ""} />
      </Field>
      <Field label="Laboratório">
        <Input name="lab" maxLength={LIMITS.lab} defaultValue={exam?.lab ?? ""} autoComplete="off" />
      </Field>
      <Field label="Pedido por">
        <Input name="requested_by" maxLength={LIMITS.requestedBy} defaultValue={exam?.requestedBy ?? ""} autoComplete="off" />
      </Field>
      <Field label="Resumo do resultado">
        <Textarea name="result_summary" maxLength={LIMITS.summary} defaultValue={exam?.summary ?? ""} />
      </Field>
      <FileButtons label={exam?.mime ? "Trocar arquivo (PDF ou JPG, até 5 MB)" : "Arquivo opcional (PDF ou JPG, até 5 MB)"} />
      {exam?.mime && (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" name="remove_file" className="size-5 accent-[var(--primary)]" />
          Remover o arquivo atual
        </label>
      )}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : exam ? "Salvar alterações" : "Salvar exame"}</Button>
    </form>
  );
}

export function ExamsView({ people, exams, defaultMember }: { people: Person[]; exams: ExamVM[]; defaultMember: string }) {
  const [modal, setModal] = useState<{ exam?: ExamVM } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove(id: string) {
    setPending(true);
    const r = await deleteExam(id);
    setPending(false);
    setError(r.ok ? null : (r.erro ?? "Não foi possível apagar."));
    setNotice(r.ok ? "Exame apagado." : null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> Novo exame
        </Button>
      </div>
      {notice && (
        <p role="status" className="-mt-2 text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
      {exams.length === 0 && <EmptyState title="Nenhum exame ainda.">Guarde o resultado e o PDF dos exames da família.</EmptyState>}
      {exams.map((x) => (
        <Card key={x.id} data-testid="exame">
          <p className="text-lg font-medium">{x.name}</p>
          <p className="mt-1 text-sm">
            {x.person}
            {x.date ? ` · ${brDate(x.date)}` : ""}
          </p>
          {x.lab && <p className="text-sm text-muted">{x.lab}</p>}
          {x.requestedBy && <p className="text-sm text-muted">Pedido por {x.requestedBy}</p>}
          {x.summary && <p className="mt-2 whitespace-pre-wrap text-sm">{x.summary}</p>}
          {x.mime && (
            <div className="mt-2">
              <FileLink href={`/saude/arquivo/exames/${x.id}`} mime={x.mime} label={`Exame ${x.name}`} />
              {x.size !== null && <span className="ml-2 text-xs text-muted">{formatSize(x.size)}</span>}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" className="h-11 px-3 text-sm" onClick={() => setModal({ exam: x })}>
              Editar
            </Button>
            <ConfirmDelete what="este exame" pending={pending} onConfirm={() => remove(x.id)} />
          </div>
        </Card>
      ))}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.exam ? "Editar exame" : "Novo exame"}>
        <ExamForm
          exam={modal?.exam}
          people={people}
          defaultMember={defaultMember}
          onDone={() => {
            setNotice(modal?.exam ? "Exame atualizado." : "Exame salvo.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
