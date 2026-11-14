"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { IGREJA_LIMITS } from "@/lib/igreja/input";
import { saveLesson } from "../carisma-actions";
import { ActionForm, ShareBadge } from "./shared";

export type LessonListItem = {
  id: string;
  title: string;
  lesson_date: string | null;
  subject: string | null;
  teacher: string | null;
  shared: boolean;
  mine: boolean;
  sharedBy: string | null;
  summary_status: "nenhum" | "pronto" | "erro";
};

export type LessonFormValues = { id: string; title: string; lesson_date: string | null; subject: string | null; teacher: string | null; notes: string | null };

export function LessonForm({ item, today, onDone }: { item?: LessonFormValues; today: string; onDone: (m?: string, id?: string) => void }) {
  return (
    <ActionForm action={saveLesson} onDone={onDone} submit={item ? "Salvar alterações" : "Salvar aula"} label={item ? "Editar aula" : "Nova aula"}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Título da aula">
        <Input name="title" maxLength={IGREJA_LIMITS.lessonTitle} defaultValue={item?.title} placeholder="Ex.: Introdução à Cristologia" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">
          <Input name="lesson_date" type="date" defaultValue={item?.lesson_date ?? (item ? "" : today)} />
        </Field>
        <Field label="Disciplina">
          <Input name="subject" maxLength={IGREJA_LIMITS.subject} defaultValue={item?.subject ?? ""} autoComplete="off" />
        </Field>
      </div>
      <Field label="Professor">
        <Input name="teacher" maxLength={IGREJA_LIMITS.teacher} defaultValue={item?.teacher ?? ""} autoComplete="off" />
      </Field>
      <Field label="Anotações">
        <Textarea name="notes" rows={8} maxLength={IGREJA_LIMITS.lessonNotes} defaultValue={item?.notes ?? ""} placeholder="O que você anotou na aula…" />
      </Field>
    </ActionForm>
  );
}

export function LessonsView({ lessons, today }: { lessons: LessonListItem[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={15} aria-hidden /> Nova aula
        </Button>
      </div>
      {lessons.length === 0 && <EmptyState title="Nenhuma aula ainda.">Crie a aula, anote o que aprendeu e anexe PDFs, documentos do Word ou fotos do quadro.</EmptyState>}
      {lessons.map((l) => (
        <Link key={l.id} href={`/ministerio/carisma/${l.id}`} className="block" data-testid="aula" aria-label={l.title}>
          <Card className="flex items-center gap-3 transition hover:brightness-105">
            <div className="min-w-0 flex-1">
              <ShareBadge mine={l.mine} shared={l.shared} sharedBy={l.sharedBy} />
              <p className="text-lg font-medium">{l.title}</p>
              <p className="text-sm text-muted">
                {[l.lesson_date ? brDate(l.lesson_date) : null, l.subject, l.teacher].filter(Boolean).join(" · ") || "Sem data"}
              </p>
              {l.summary_status === "pronto" && <p className="text-[13px] text-primary">Resumo pronto</p>}
            </div>
            <ChevronRight size={20} aria-hidden className="shrink-0 text-muted" />
          </Card>
        </Link>
      ))}
      <Modal open={open} onClose={() => setOpen(false)} title="Nova aula">
        {open && (
          <LessonForm
            today={today}
            onDone={(_, id) => {
              setOpen(false);
              if (id) router.push(`/ministerio/carisma/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
