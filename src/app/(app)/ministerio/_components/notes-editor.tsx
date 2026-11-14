"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Bold, Check, Eye, Heading1, Highlighter, Italic, List, Redo2, Underline, Undo2, type LucideIcon } from "lucide-react";
import { btnBase, btnVariant, TapArea, Textarea } from "@/components/ui";
import {
  canRedo,
  canUndo,
  hasLinePrefix,
  isWrapped,
  newHistory,
  NOTES_MAX,
  pushHistory,
  redo,
  toggleInline,
  toggleLinePrefix,
  undo,
  type History,
  type InlineKind,
  type LineKind,
  type Sel,
} from "@/lib/igreja/notes-markup";
import { saveLessonNotes } from "../carisma-actions";
import { NotesView } from "./notes-view";

export const AUTOSAVE_MS = 1200;

/** O que o painel do Oli usa: gravar (já confirmado pela pessoa) e garantir que o que está na tela já foi salvo. */
export type NotebookApi = {
  append: (text: string) => Promise<{ ok: true } | { ok: false; erro: string }>;
  flush: () => Promise<boolean>;
};

type SaveStatus = "salvo" | "pendente" | "salvando" | "erro";

const tool = `${btnBase} ${btnVariant.ghost} size-[34px] shrink-0 p-0 disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-primary aria-pressed:ring-1 aria-pressed:ring-primary/40`;

function ToolButton({ label, icon: Icon, pressed, disabled, onClick, hint }: { label: string; icon: LucideIcon; pressed?: boolean; disabled?: boolean; onClick: () => void; hint?: string }) {
  return (
    <button type="button" className={tool} aria-label={label} title={hint ? `${label} (${hint})` : label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <TapArea />
      <Icon size={16} aria-hidden />
    </button>
  );
}

export function NotesEditor({ lessonId, initial, onChange, apiRef }: { lessonId: string; initial: string; onChange: (text: string) => void; apiRef: Ref<NotebookApi> }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  const [text, setText] = useState(initial);
  const [sel, setSel] = useState({ start: initial.length, end: initial.length });
  const [history, setHistory] = useState<History>(() => newHistory(initial));
  const [status, setStatus] = useState<SaveStatus>("salvo");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState(false);
  const [preview, setPreview] = useState(false);

  const latest = useRef(initial);
  const saved = useRef(initial);
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  /** Salva o que está na tela (e o que for digitado enquanto salva), um pedido por vez, sempre o mais novo por último. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) return running.current;
    if (latest.current === saved.current) {
      setStatus("salvo");
      return true;
    }
    const run = (async () => {
      try {
        while (latest.current !== saved.current) {
          const v = latest.current;
          setStatus("salvando");
          const r = await saveLessonNotes(lessonId, v);
          if (!r.ok) {
            setSaveError(r.erro ?? "Não foi possível salvar o caderno.");
            setStatus("erro");
            return false;
          }
          saved.current = v;
        }
        setSaveError(null);
        setStatus("salvo");
        return true;
      } catch {
        setSaveError("Não foi possível falar com o servidor.");
        setStatus("erro");
        return false;
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    return run;
  }, [lessonId]);

  const schedule = useCallback(() => {
    setStatus("pendente");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  // Ao sair da aula ou esconder a aba, o que falta salvar vai agora.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  // Depois de uma edição pelos botões, devolve o foco e a seleção ao campo.
  useLayoutEffect(() => {
    const p = pendingSel.current;
    const ta = taRef.current;
    if (p && ta) {
      pendingSel.current = null;
      ta.focus();
      ta.setSelectionRange(p.start, p.end);
    }
  }, [text]);

  const commit = useCallback(
    (next: string, range: { start: number; end: number }, opts: { group?: boolean; keepHistory?: boolean } = {}) => {
      latest.current = next;
      pendingSel.current = opts.group ? null : range;
      setText(next);
      setSel(range);
      setLimitMsg(false);
      if (!opts.keepHistory) setHistory((h) => pushHistory(h, { text: next, ...range }, Date.now(), opts.group));
      onChange(next);
      schedule();
    },
    [onChange, schedule],
  );

  const current = (): Sel => {
    const ta = taRef.current;
    return { text: latest.current, start: ta?.selectionStart ?? sel.start, end: ta?.selectionEnd ?? sel.end };
  };

  const applyResult = (r: Sel | null) => {
    if (!r) {
      setLimitMsg(true);
      return;
    }
    commit(r.text, { start: r.start, end: r.end });
  };
  const inline = (kind: InlineKind) => applyResult(toggleInline(current(), kind));
  const line = (kind: LineKind) => applyResult(toggleLinePrefix(current(), kind));

  const goTo = (h: History) => {
    const e = h.stack[h.index];
    setHistory(h);
    commit(e.text, { start: e.start, end: e.end }, { keepHistory: true });
  };
  const doUndo = () => {
    if (canUndo(historyRef.current)) goTo(undo(historyRef.current));
  };
  const doRedo = () => {
    if (canRedo(historyRef.current)) goTo(redo(historyRef.current));
  };

  useImperativeHandle(
    apiRef,
    () => ({
      flush,
      append: async (add: string) => {
        const t = add.replace(/\r\n?/g, "\n").trim();
        if (!t) return { ok: false as const, erro: "Não há texto para anotar." };
        const cur = latest.current.replace(/\s+$/, "");
        const next = cur ? `${cur}\n\n${t}` : t;
        if (next.length > NOTES_MAX) return { ok: false as const, erro: `Não cabe no caderno: passaria de ${NOTES_MAX} caracteres. Encurte o texto.` };
        commit(next, { start: next.length, end: next.length });
        const ok = await flush();
        return ok ? { ok: true as const } : { ok: false as const, erro: "O texto entrou no caderno, mas não consegui salvar agora. Tente de novo." };
      },
    }),
    [commit, flush],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      b: () => inline("bold"),
      i: () => inline("italic"),
      u: () => inline("underline"),
      z: e.shiftKey ? doRedo : doUndo,
      y: doRedo,
    };
    if (map[k]) {
      e.preventDefault();
      map[k]();
    }
  };

  const s: Sel = { text, start: sel.start, end: sel.end };
  const left = NOTES_MAX - text.length;
  const nearLimit = left <= 500;
  const syncSel = () => {
    const ta = taRef.current;
    if (ta) setSel({ start: ta.selectionStart, end: ta.selectionEnd });
  };

  return (
    <section aria-label="Caderno de anotações" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-medium">Caderno</h3>
        <p role="status" aria-live="polite" data-testid="notas-status" className={`flex items-center gap-1 text-[12.5px] ${status === "erro" ? "text-danger" : "text-muted"}`}>
          {status === "salvo" && (
            <>
              <Check size={13} aria-hidden /> Salvo
            </>
          )}
          {status === "pendente" && "Alterações não salvas"}
          {status === "salvando" && "Salvando…"}
          {status === "erro" && (saveError ?? "Não salvou")}
        </p>
      </div>
      <Textarea
        ref={taRef}
        aria-label="Anotações da aula"
        aria-describedby={counterId}
        rows={10}
        maxLength={NOTES_MAX}
        value={text}
        placeholder="O que você anotou na aula…"
        onChange={(e) => {
          const ta = e.currentTarget;
          commit(ta.value, { start: ta.selectionStart, end: ta.selectionEnd }, { group: true });
        }}
        onSelect={syncSel}
        onKeyDown={onKeyDown}
        onBlur={() => void flush()}
        className="min-h-[220px] resize-y py-3 leading-relaxed"
      />
      <div role="toolbar" aria-label="Formatação do caderno" className="flex flex-wrap items-center gap-1.5">
        <ToolButton label="Negrito" hint="Ctrl+B" icon={Bold} pressed={isWrapped(s, "bold")} onClick={() => inline("bold")} />
        <ToolButton label="Itálico" hint="Ctrl+I" icon={Italic} pressed={isWrapped(s, "italic")} onClick={() => inline("italic")} />
        <ToolButton label="Sublinhado" hint="Ctrl+U" icon={Underline} pressed={isWrapped(s, "underline")} onClick={() => inline("underline")} />
        <ToolButton label="Marca-texto" icon={Highlighter} pressed={isWrapped(s, "mark")} onClick={() => inline("mark")} />
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        <ToolButton label="Título" icon={Heading1} pressed={hasLinePrefix(s, "heading")} onClick={() => line("heading")} />
        <ToolButton label="Lista" icon={List} pressed={hasLinePrefix(s, "list")} onClick={() => line("list")} />
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        <ToolButton label="Desfazer" hint="Ctrl+Z" icon={Undo2} disabled={!canUndo(history)} onClick={doUndo} />
        <ToolButton label="Refazer" hint="Ctrl+Shift+Z" icon={Redo2} disabled={!canRedo(history)} onClick={doRedo} />
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        <ToolButton label="Pré-visualizar" icon={Eye} pressed={preview} onClick={() => setPreview((p) => !p)} />
      </div>
      <p id={counterId} data-testid="notas-contador" role={limitMsg ? "alert" : undefined} className={`text-[12.5px] tabular-nums ${limitMsg || left <= 0 ? "text-danger" : nearLimit ? "text-ink" : "text-muted"}`}>
        {limitMsg ? `Limite de ${NOTES_MAX} caracteres: não cabe a marcação. ` : ""}
        {text.length}/{NOTES_MAX} caracteres (a marcação conta)
      </p>
      {preview && (
        <div data-testid="notas-previa" aria-label="Pré-visualização do caderno" className="rounded-[14px] border border-line bg-surface-solid p-3.5 text-[15px]">
          {text.trim() ? <NotesView text={text} /> : <p className="text-sm text-muted">Nada para mostrar ainda.</p>}
        </div>
      )}
    </section>
  );
}
