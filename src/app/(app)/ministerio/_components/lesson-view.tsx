"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ellipsis, ExternalLink, FileText, Image as ImageIcon, Pencil, Sparkles } from "lucide-react";
import { Button, Card, EmptyState, Field, FormError, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { IGREJA_LIMITS } from "@/lib/igreja/input";
import { ACCEPT_BY_GROUP, baseName, extOf, validateDeclaredUpload } from "@/lib/igreja/files";
import { formatBytes, putToSession } from "@/lib/igreja/upload-client";
import {
  cancelDriveUpload,
  confirmDriveUpload,
  deleteLesson,
  deleteLessonFile,
  prepareDriveUpload,
  renameLessonFile,
  saveSummary,
  setLessonShared,
  summarizeLessonAction,
} from "../carisma-actions";
import { LessonForm } from "./lessons-view";
import { ConfirmDelete, Feedback, Multiline, smallBtn, useRunner } from "./shared";
import { NotesEditor, type NotebookApi } from "./notes-editor";
import { NotesView } from "./notes-view";
import { StudyPanel } from "./study-panel";

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

/**
 * Uma linha compacta da lista de arquivos: ícone, nome (cortado; nome inteiro no title), tamanho e o "⋯" com as ações
 * (Abrir no Drive; Renomear e Apagar só para o dono, com as mesmas confirmações). Esc ou toque fora fecha o menu.
 */
function FileItem({ file: f, mine, pending, run }: { file: FileVM; mine: boolean; pending: boolean; run: ReturnType<typeof useRunner>["run"] }) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  // Perto do fim da tela o menu (e a confirmação de exclusão, que o faz crescer) abre para cima: aberto para baixo,
  // o fim dele ficava sob a barra inferior fixa e o botão Apagar não podia ser tocado.
  const [up, setUp] = useState(false);
  const [name, setName] = useState(baseName(f.name));
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const ext = extOf(f.name);
  const hasActions = Boolean(f.link) || mine;

  useEffect(() => {
    if (!menu || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const NAV = 96; // barra inferior flutuante (62px + 14px do fundo + folga)
    const MENU = 260; // altura máxima do menu com a confirmação aberta
    setUp(window.innerHeight - NAV - r.bottom < MENU && r.top > MENU);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menu]);

  const item = "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-[14.5px] font-medium text-ink hover:bg-accent-soft";
  return (
    <li data-testid="arquivo-aula" className="flex min-h-14 items-center gap-3 py-1.5 pl-4 pr-1.5">
      <span className="shrink-0 text-primary">
        <FileIcon mime={f.mime} />
      </span>
      <p className="min-w-0 flex-1 truncate text-[15px] font-medium" title={f.name}>
        {f.name}
      </p>
      <span className="shrink-0 text-[12px] tabular-nums text-muted">{formatBytes(f.size)}</span>
      {hasActions && (
        <div ref={boxRef} className="relative shrink-0">
          <button
            ref={btnRef}
            type="button"
            aria-label={`Ações de ${f.name}`}
            aria-expanded={menu}
            aria-controls={menuId}
            onClick={() => setMenu((m) => !m)}
            className="grid size-11 place-items-center rounded-full text-muted transition hover:bg-accent-soft hover:text-deep"
          >
            <Ellipsis size={20} aria-hidden />
          </button>
          <div
            id={menuId}
            hidden={!menu}
            aria-label={`Ações de ${f.name}`}
            role="group"
            data-placement={up ? "up" : "down"}
            className={`absolute right-0 z-30 ${up ? "bottom-12" : "top-12"} flex w-60 flex-col gap-0.5 rounded-[18px] border border-line bg-surface-solid p-1.5 shadow-lg`}
          >
            {f.link && (
              <a href={f.link} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setMenu(false)}>
                <ExternalLink size={16} aria-hidden className="text-primary" /> Abrir no Drive
              </a>
            )}
            {mine && (
              <button
                type="button"
                className={item}
                onClick={() => {
                  setName(baseName(f.name));
                  setErr(null);
                  setMenu(false);
                  setRenaming(true);
                }}
              >
                <Pencil size={15} aria-hidden className="text-primary" /> Renomear
              </button>
            )}
            {mine && (
              <div className="px-1">
                <ConfirmDelete what="este arquivo (vai para a lixeira do Drive)" pending={pending} onConfirm={() => run(() => deleteLessonFile(f.id), "Arquivo enviado para a lixeira do Google Drive.")} />
              </div>
            )}
          </div>
        </div>
      )}
      {mine && (
        <Modal open={renaming} onClose={() => setRenaming(false)} title="Renomear arquivo">
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(() => renameLessonFile(f.id, name), "Arquivo renomeado.");
              if (r.ok) setRenaming(false);
              else setErr(r.erro ?? "Não foi possível renomear.");
            }}
          >
            <Field label="Novo nome">
              <div className="flex items-center gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={115} required autoFocus />
                {ext && <span className="shrink-0 text-[15px] text-muted">.{ext}</span>}
              </div>
            </Field>
            <FormError message={err} />
            <p className="text-[13px] text-muted">O nome muda aqui e no seu Google Drive. A extensão continua a mesma.</p>
            <Button disabled={pending}>{pending ? "Salvando…" : "Salvar nome"}</Button>
          </form>
        </Modal>
      )}
    </li>
  );
}

/** Envio: prepara no servidor → PUT direto ao Drive com progresso → confirma no servidor (bytes conferidos lá). */
function UploadBox({ lessonId, onNotice, onError }: { lessonId: string; onNotice: (m: string) => void; onError: (m: string | null) => void }) {
  const router = useRouter();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busy, setBusy] = useState<{ name: string; pct: number; phase: "enviando" | "conferindo" } | null>(null);

  async function send(file: File, group: string) {
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
      const el = inputs.current[group];
      if (el) el.value = "";
      router.refresh();
    }
  }

  const groups = [
    { key: "texto", label: "Texto", hint: "Texto (.txt ou .docx)", aria: "Escolher arquivo de texto" },
    { key: "imagem", label: "Imagem", hint: "Imagem JPG ou PNG", aria: "Escolher imagem" },
    { key: "pdf", label: "PDF", hint: "Arquivo PDF", aria: "Escolher PDF" },
  ] as const;

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Adicionar arquivo" className="flex flex-wrap items-center gap-2">
        {groups.map((g) => (
          <span key={g.key} className="contents">
            <input
              ref={(el) => {
                inputs.current[g.key] = el;
              }}
              type="file"
              accept={ACCEPT_BY_GROUP[g.key]}
              className="sr-only"
              tabIndex={-1}
              aria-label={g.aria}
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void send(f, g.key);
              }}
            />
            <Button type="button" size="sm" variant="ghost" title={g.hint} disabled={busy !== null} onClick={() => inputs.current[g.key]?.click()}>
              {g.key === "imagem" ? <ImageIcon size={14} aria-hidden /> : <FileText size={14} aria-hidden />} {g.label}
            </Button>
          </span>
        ))}
      </div>
      <p className="text-[13px] text-muted">
        Texto (.txt ou .docx), imagem JPG/PNG ou PDF, até 20 MB cada. Arquivo .doc (Word antigo) não é aceito: abra no Word ou no Google Docs e salve como .docx ou PDF.
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
  // Texto vivo do caderno (o editor salva sozinho); o "Editar aula" repassa este texto para não sobrescrever com o antigo.
  const [notes, setNotes] = useState(lesson.notes ?? "");
  const notebook = useRef<NotebookApi>(null);
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
        {!mine && (lesson.notes ? <NotesView text={lesson.notes} className="mt-3 text-[15px]" /> : <p className="mt-3 text-sm text-muted">Sem anotações.</p>)}
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
        <div className="flex flex-col gap-3">
          <NotesEditor lessonId={lesson.id} initial={lesson.notes ?? ""} onChange={setNotes} apiRef={notebook} />
          {canSummarize && <StudyPanel lessonId={lesson.id} notebook={notebook} />}
        </div>
      )}

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

      <SummarySection key={`${lesson.summary_status}-${lesson.summarized_at}-${lesson.summary?.length ?? 0}`} lesson={lesson} mine={mine} canSummarize={canSummarize} run={run} pending={pending} />

      {/* Arquivos no fim da tela, em lista compacta (uma linha por arquivo, ações no "⋯") */}
      <section aria-label="Arquivos da aula" className="flex flex-col gap-3">
        <h3 className="text-lg font-medium">Arquivos</h3>
        {!mine && !viewerHasGoogle && ready.length > 0 && (
          <p role="note" className="text-sm text-muted">
            Os arquivos ficam no Google Drive de quem compartilhou. <a href="/api/google/connect?drive=1" className="font-medium text-link">Conecte sua conta Google</a> para abrir.
          </p>
        )}
        {ready.length === 0 && pendingFiles.length === 0 && <p className="text-sm text-muted">Nenhum arquivo ainda.</p>}
        {ready.length > 0 && (
          <Card className="relative z-20 overflow-visible p-0">
            <ul aria-label="Lista de arquivos" className="divide-y divide-line">
              {ready.map((f) => (
                <FileItem key={f.id} file={f} mine={mine} pending={pending} run={run} />
              ))}
            </ul>
          </Card>
        )}
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

      <Modal open={editing} onClose={() => setEditing(false)} title="Editar aula">
        {editing && (
          <LessonForm
            item={lesson}
            notesValue={notes}
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
