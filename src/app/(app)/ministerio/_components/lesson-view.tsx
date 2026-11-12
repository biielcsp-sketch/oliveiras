"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, Image as ImageIcon, Sparkles, Upload } from "lucide-react";
import { Button, Card, EmptyState, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { IGREJA_LIMITS } from "@/lib/igreja/input";
import { ACCEPT_ATTR, validateDeclaredUpload } from "@/lib/igreja/files";
import { formatBytes, putToSession } from "@/lib/igreja/upload-client";
import {
  cancelDriveUpload,
  confirmDriveUpload,
  deleteLesson,
  deleteLessonFile,
  prepareDriveUpload,
  saveSummary,
  setLessonShared,
  summarizeLessonAction,
} from "../carisma-actions";
import { LessonForm } from "./lessons-view";
import { ConfirmDelete, Feedback, Multiline, smallBtn, useRunner } from "./shared";

type Lesson = {
  id: string;
  title: string;
  lesson_date: string | null;
  subject: string | null;
  teacher: string | null;
  notes: string | null;
  summary: string | null;
  summary_status: "nenhum" | "pronto" | "erro";
  summarized_at: string | null;
  shared: boolean;
  hasFolder: boolean;
};
type FileVM = { id: string; name: string; mime: string; size: number; status: "pendente" | "pronto"; link: string | null };

function FileIcon({ mime }: { mime: string }) {
  return mime.startsWith("image/") ? <ImageIcon size={18} aria-hidden /> : <FileText size={18} aria-hidden />;
}

/** Envio: prepara no servidor → PUT direto ao Drive com progresso → confirma no servidor (bytes conferidos lá). */
function UploadBox({ lessonId, onNotice, onError }: { lessonId: string; onNotice: (m: string) => void; onError: (m: string | null) => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ name: string; pct: number; phase: "enviando" | "conferindo" } | null>(null);

  async function send(file: File) {
    onError(null);
    const check = validateDeclaredUpload({ name: file.name, mime: file.type, size: file.size });
    if (!check.ok) return onError(check.erro);
    setBusy({ name: check.value.displayName, pct: 0, phase: "enviando" });
    try {
      const prep = await prepareDriveUpload({ lessonId, name: file.name, mime: file.type, size: file.size });
      if (!prep.ok) return onError(prep.erro);
      const put = await putToSession(prep.uploadUrl, file, (pct) => setBusy((b) => (b ? { ...b, pct } : b)));
      if (!put.ok) {
        await cancelDriveUpload(prep.fileId).catch(() => undefined);
        return onError("O envio para o Google Drive falhou. Confira a internet e tente de novo.");
      }
      setBusy((b) => (b ? { ...b, pct: 100, phase: "conferindo" } : b));
      const r = await confirmDriveUpload(prep.fileId);
      if (!r.ok) onError(r.erro ?? "Não foi possível conferir o arquivo.");
      else onNotice("Arquivo guardado no seu Google Drive.");
    } catch {
      onError("Não foi possível falar com o servidor. Tente de novo.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        id="carisma-arquivo"
        aria-label="Escolher arquivo da aula"
        disabled={busy !== null}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void send(f);
        }}
      />
      <label
        htmlFor="carisma-arquivo"
        className={`glass glass-shine inline-flex h-12 w-fit cursor-pointer items-center gap-2 rounded-full border border-[var(--glass-edge)] px-5 text-[15px] font-medium shadow-glass ${busy ? "pointer-events-none opacity-50" : ""}`}
      >
        <Upload size={18} aria-hidden /> Adicionar arquivo
      </label>
      <p className="text-[13px] text-muted">
        PDF, Word (.docx) ou imagem JPG/PNG, até 20 MB cada. Arquivo .doc (Word antigo) não é aceito: abra no Word ou no Google Docs e salve como .docx ou PDF.
      </p>
      {busy && (
        <div role="status" aria-live="polite" className="flex flex-col gap-1">
          <p className="text-sm">
            {busy.phase === "enviando" ? `Enviando ${busy.name}… ${busy.pct}%` : `Conferindo ${busy.name}…`}
          </p>
          <progress max={100} value={busy.pct} aria-label="Progresso do envio" className="h-2 w-full overflow-hidden rounded-full" />
        </div>
      )}
    </div>
  );
}

function SummarySection({ lesson, mine, canSummarize, run, pending }: { lesson: Lesson; mine: boolean; canSummarize: boolean; run: ReturnType<typeof useRunner>["run"]; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.summary ?? "");
  return (
    <section aria-label="Resumo da aula" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-medium">
          <Sparkles size={18} aria-hidden className="text-primary" /> Resumo
        </h3>
        <p data-testid="resumo-status" className="text-[13px] text-muted">
          {lesson.summary_status === "pronto"
            ? `Pronto${lesson.summarized_at ? ` · ${brDate(lesson.summarized_at.slice(0, 10))}` : ""}`
            : lesson.summary_status === "erro"
              ? "Erro no último resumo"
              : "Sem resumo"}
        </p>
      </div>
      {lesson.summary_status === "erro" && !lesson.summary && <p className="text-sm text-danger">Não consegui resumir a aula da última vez. Tente de novo.</p>}
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Editar resumo" rows={14} maxLength={IGREJA_LIMITS.summary} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button
              type="button"
              className={smallBtn}
              disabled={pending}
              onClick={async () => {
                const r = await run(() => saveSummary(lesson.id, text), "Resumo salvo.");
                if (r.ok) setEditing(false);
              }}
            >
              Salvar resumo
            </Button>
            <Button type="button" variant="ghost" className={smallBtn} onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : lesson.summary ? (
        <Card>
          <Multiline text={lesson.summary} className="text-[15px]" />
        </Card>
      ) : (
        <EmptyState title="Ainda sem resumo.">{mine ? "Toque em “Resumir aula” para a IA resumir as anotações e os arquivos." : "Quem compartilhou ainda não resumiu esta aula."}</EmptyState>
      )}
      {mine && !editing && (
        <div className="flex flex-wrap gap-2">
          {canSummarize && (
            <Button type="button" disabled={pending} onClick={() => run(() => summarizeLessonAction(lesson.id), (r) => r.aviso ?? "Resumo pronto.")}>
              <Sparkles size={18} aria-hidden /> {pending ? "Resumindo…" : "Resumir aula"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setText(lesson.summary ?? "");
              setEditing(true);
            }}
          >
            {lesson.summary ? "Editar resumo" : "Escrever resumo"}
          </Button>
        </div>
      )}
    </section>
  );
}

export function LessonView({
  lesson,
  files,
  mine,
  sharedBy,
  canUpload,
  canSummarize,
  withoutGoogle,
  viewerHasGoogle,
  today,
}: {
  lesson: Lesson;
  files: FileVM[];
  mine: boolean;
  sharedBy: string | null;
  canUpload: boolean;
  canSummarize: boolean;
  withoutGoogle: string[];
  viewerHasGoogle: boolean;
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const { notice, setNotice, error, pending, run } = useRunner();
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Marca otimista: muda na hora e volta se o Drive ou o banco recusarem.
  const [shared, setShared] = useState(lesson.shared);
  const ready = files.filter((f) => f.status === "pronto");
  const pendingFiles = files.filter((f) => f.status === "pendente");

  return (
    <div className="flex flex-col gap-6">
      <Link href="/ministerio/carisma" className="inline-flex min-h-11 w-fit items-center gap-1 text-[15px] font-medium text-link">
        <ArrowLeft size={18} aria-hidden /> Aulas
      </Link>
      <Card>
        {sharedBy && <p className="text-[13px] font-medium text-primary">{sharedBy}</p>}
        <h2 className="text-xl font-semibold tracking-tight">{lesson.title}</h2>
        <p className="text-sm text-muted">{[lesson.lesson_date ? brDate(lesson.lesson_date) : null, lesson.subject, lesson.teacher].filter(Boolean).join(" · ") || "Sem data"}</p>
        {lesson.notes ? <Multiline text={lesson.notes} className="mt-3 text-[15px]" /> : <p className="mt-3 text-sm text-muted">Sem anotações.</p>}
        {mine && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" className={smallBtn} onClick={() => setEditing(true)}>
              Editar aula
            </Button>
            <ConfirmDelete
              what="esta aula (os arquivos vão para a lixeira do seu Google Drive)"
              pending={pending}
              onConfirm={async () => {
                const r = await run(() => deleteLesson(lesson.id));
                if (r.ok) router.push("/ministerio/carisma");
              }}
            />
          </div>
        )}
      </Card>
      <Feedback notice={notice} error={error ?? uploadError} />

      {mine && (
        <section aria-label="Compartilhamento" className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-3 text-[15px]">
            <input
              type="checkbox"
              checked={shared}
              disabled={pending}
              onChange={async (e) => {
                const next = e.target.checked;
                setShared(next);
                const r = await run(() => setLessonShared(lesson.id, next), (x) => x.aviso ?? (next ? "Aula compartilhada com a família." : "Aula só sua de novo."));
                if (!r.ok) setShared(!next);
              }}
              className="size-5 accent-[var(--color-primary)]"
            />
            <span>
              Compartilhar com a família
              <span className="block text-[13px] text-muted">Quem é da família só lê. Os arquivos abrem pelo Google Drive com a conta Google de cada um.</span>
            </span>
          </label>
          {shared && lesson.shared && withoutGoogle.length > 0 && (
            <p role="note" className="text-sm text-muted">
              {withoutGoogle.join(", ")} ainda não conectou o Google: os arquivos só abrem depois que conectar.
            </p>
          )}
          {shared && lesson.shared && lesson.hasFolder && (
            <Button type="button" variant="ghost" className={`${smallBtn} w-fit`} disabled={pending} onClick={() => run(() => setLessonShared(lesson.id, true), (r) => r.aviso ?? "Acesso aos arquivos atualizado.")}>
              Atualizar acesso aos arquivos
            </Button>
          )}
        </section>
      )}

      <section aria-label="Arquivos da aula" className="flex flex-col gap-3">
        <h3 className="text-lg font-medium">Arquivos</h3>
        {!mine && !viewerHasGoogle && ready.length > 0 && (
          <p role="note" className="text-sm text-muted">
            Os arquivos ficam no Google Drive de quem compartilhou. <a href="/api/google/connect?drive=1" className="font-medium text-link">Conecte sua conta Google</a> para abrir.
          </p>
        )}
        {ready.length === 0 && pendingFiles.length === 0 && <p className="text-sm text-muted">Nenhum arquivo ainda.</p>}
        {ready.map((f) => (
          <Card key={f.id} data-testid="arquivo-aula" className="flex flex-wrap items-center gap-3">
            <span className="text-primary">
              <FileIcon mime={f.mime} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{f.name}</p>
              <p className="text-[13px] text-muted">{formatBytes(f.size)}</p>
            </div>
            {f.link && (
              <a href={f.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-link">
                Abrir no Drive <ExternalLink size={16} aria-hidden />
              </a>
            )}
            {mine && <ConfirmDelete what="este arquivo (vai para a lixeira do Drive)" pending={pending} onConfirm={() => run(() => deleteLessonFile(f.id), "Arquivo enviado para a lixeira do Google Drive.")} />}
          </Card>
        ))}
        {mine &&
          pendingFiles.map((f) => (
            <p key={f.id} className="text-sm text-muted">
              {f.name}: envio não concluído.{" "}
              <button type="button" className="font-medium text-link" onClick={() => run(() => cancelDriveUpload(f.id), "Envio descartado.")}>
                Descartar
              </button>
            </p>
          ))}
        {canUpload && (
          <UploadBox
            lessonId={lesson.id}
            onNotice={(m) => {
              setUploadError(null);
              setNotice(m);
            }}
            onError={(m) => {
              setUploadError(m);
              if (m) setNotice(null);
            }}
          />
        )}
      </section>

      <SummarySection key={`${lesson.summary_status}-${lesson.summarized_at}-${lesson.summary?.length ?? 0}`} lesson={lesson} mine={mine} canSummarize={canSummarize} run={run} pending={pending} />

      <Modal open={editing} onClose={() => setEditing(false)} title="Editar aula">
        {editing && (
          <LessonForm
            item={lesson}
            today={today}
            onDone={(m) => {
              setNotice(m ?? "Aula atualizada.");
              setEditing(false);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
