"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import { Bold, Check, ChevronDown, Highlighter, Italic, List, Redo2, Strikethrough, Underline, Undo2, type LucideIcon } from "lucide-react";
import { TapArea } from "@/components/ui";
import {
  blockPlain,
  deleteStep,
  docLength,
  docToMarkup,
  domToDoc,
  fitsLimit,
  flagsAt,
  insertNewline,
  kindAt,
  locate,
  markupToDoc,
  replaceRange,
  setKind,
  toggleFlag,
  toggleList,
  ZWSP,
  type Doc,
  type Flag,
  type Kind,
} from "@/lib/igreja/notes-doc";
import { buildDom, getOffsets, isFlat, setOffsets } from "@/lib/igreja/notes-dom";
import { canRedo, canUndo, newHistory, NOTES_MAX, pushHistory, redo, undo, type History } from "@/lib/igreja/notes-markup";
import { saveLessonNotes } from "../carisma-actions";

export const AUTOSAVE_MS = 1200;

/** O que o painel do Oli usa: gravar (já confirmado pela pessoa) e garantir que o que está na tela já foi salvo. */
export type NotebookApi = {
  append: (text: string) => Promise<{ ok: true } | { ok: false; erro: string }>;
  flush: () => Promise<boolean>;
};

type SaveStatus = "salvo" | "pendente" | "salvando" | "erro";

const KIND_LABEL: Record<Kind, string> = { p: "Texto normal", h1: "Título", h2: "Subtítulo", li: "Texto normal" };
const MENU_KINDS: { kind: Kind; label: string; cls: string }[] = [
  { kind: "p", label: "Texto normal", cls: "text-[15px]" },
  { kind: "h1", label: "Título", cls: "text-[19px] font-semibold" },
  { kind: "h2", label: "Subtítulo", cls: "text-[16px] font-semibold text-deep" },
];

const tool =
  "relative inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] text-ink transition hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-primary";

function ToolButton({ label, icon: Icon, pressed, disabled, onClick, hint }: { label: string; icon: LucideIcon; pressed?: boolean; disabled?: boolean; onClick: () => void; hint?: string }) {
  return (
    <button type="button" className={tool} aria-label={label} title={hint ? `${label} (${hint})` : label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <TapArea />
      <Icon size={18} aria-hidden />
    </button>
  );
}

const Sep = () => <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />;

export function NotesEditor({ lessonId, initial, onChange, apiRef }: { lessonId: string; initial: string; onChange: (text: string) => void; apiRef: Ref<NotebookApi> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const styleBtnRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const counterId = useId();
  const listId = useId();

  const [count, setCount] = useState(initial.length);
  const [history, setHistory] = useState<History>(() => newHistory(initial));
  const [status, setStatus] = useState<SaveStatus>("salvo");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState(false);
  const [empty, setEmpty] = useState(!initial.trim());
  const [ui, setUi] = useState<{ flags: string; kind: Kind }>({ flags: "", kind: "p" });
  const [menu, setMenu] = useState<{ open: boolean; left: number; byKeyboard: boolean }>({ open: false, left: 8, byKeyboard: false });

  const docRef = useRef<Doc>(markupToDoc(initial));
  const latest = useRef(initial);
  const saved = useRef(initial);
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const composing = useRef(false);
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

  /** Monta o DOM a partir da marcação inicial (só aqui, ao desfazer/refazer e depois de ações da barra; nunca a cada tecla). */
  useLayoutEffect(() => {
    if (rootRef.current) buildDom(rootRef.current, docRef.current);
  }, []);

  const refreshUi = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const o = getOffsets(root);
    if (!o) return;
    selRef.current = o;
    const doc = docRef.current;
    const flags = flagsAt(doc, o.start, o.end);
    const kind = kindAt(doc, o.start);
    setUi((u) => (u.flags === flags && u.kind === kind ? u : { flags, kind }));
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshUi);
    return () => document.removeEventListener("selectionchange", refreshUi);
  }, [refreshUi]);

  /** Registra o estado novo (marcação) no histórico, no autosave e nos contadores. */
  const record = useCallback(
    (doc: Doc, range: { start: number; end: number }, opts: { group?: boolean; keepHistory?: boolean } = {}) => {
      const markup = docToMarkup(doc);
      docRef.current = doc;
      latest.current = markup;
      selRef.current = range;
      setCount(markup.length);
      setEmpty(doc.length === 1 && blockPlain(doc[0]).split(ZWSP).join("") === "");
      setLimitMsg(false);
      const flags = flagsAt(doc, range.start, range.end);
      setUi({ flags, kind: kindAt(doc, range.start) });
      if (!opts.keepHistory) setHistory((h) => pushHistory(h, { text: markup, ...range }, Date.now(), opts.group));
      onChange(markup);
      schedule();
    },
    [onChange, schedule],
  );

  /** Troca o modelo e remonta o DOM (ações da barra, Enter, apagar entre blocos, colar, desfazer). */
  const applyDoc = useCallback(
    (doc: Doc, start: number, end = start, opts: { keepHistory?: boolean } = {}) => {
      const root = rootRef.current;
      if (!root) return;
      const max = docLength(doc);
      const s = Math.min(start, max);
      const e = Math.min(end, max);
      buildDom(root, doc);
      root.focus({ preventScroll: true });
      setOffsets(root, s, e);
      if (s === e) document.getSelection()?.anchorNode?.parentElement?.scrollIntoView?.({ block: "nearest" });
      record(doc, { start: s, end: e }, opts);
    },
    [record],
  );

  const curSel = () => {
    const root = rootRef.current;
    return (root && getOffsets(root)) || selRef.current;
  };

  const tryApply = (r: { doc: Doc; caret: number } | null) => {
    if (!r) return;
    if (!fitsLimit(r.doc)) {
      setLimitMsg(true);
      return;
    }
    applyDoc(r.doc, r.caret);
  };

  const inline = (flag: Flag) => {
    const { start, end } = curSel();
    const r = toggleFlag(docRef.current, start, end, flag);
    if (!fitsLimit(r.doc)) {
      setLimitMsg(true);
      return;
    }
    applyDoc(r.doc, r.start, r.end);
  };
  const list = () => {
    const { start, end } = curSel();
    applyDoc(toggleList(docRef.current, start, end), start, end);
  };
  const chooseKind = (kind: Kind) => {
    const { start, end } = curSel();
    const doc = setKind(docRef.current, start, end, kind);
    if (!fitsLimit(doc)) setLimitMsg(true);
    else applyDoc(doc, start, end);
  };

  /** Lê o DOM depois de uma digitação normal do navegador. */
  const sync = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const o = getOffsets(root) ?? selRef.current;
    const doc = domToDoc(root);
    if (composing.current) {
      record(doc, o, { group: true });
      return;
    }
    if (!fitsLimit(doc)) {
      // passou do limite: volta ao último estado que cabia
      const back = markupToDoc(latest.current);
      applyDoc(back, selRef.current.start, selRef.current.start, { keepHistory: true });
      setLimitMsg(true);
      return;
    }
    if (!isFlat(root)) {
      applyDoc(doc, o.start, o.end);
      return;
    }
    record(doc, o, { group: true });
  }, [applyDoc, record]);

  const goTo = (h: History) => {
    const e = h.stack[h.index];
    setHistory(h);
    applyDoc(markupToDoc(e.text), e.start, e.end, { keepHistory: true });
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
        const doc = markupToDoc(next);
        // o que se grava é a marcação normalizada (com escapes), que pode ser maior que `next`
        if (!fitsLimit(doc)) return { ok: false as const, erro: `Não cabe no caderno: passaria de ${NOTES_MAX} caracteres (a formatação também conta). Encurte o texto.` };
        applyDoc(doc, docLength(doc));
        const ok = await flush();
        return ok ? { ok: true as const } : { ok: false as const, erro: "O texto entrou no caderno, mas não consegui salvar agora. Tente de novo." };
      },
    }),
    [applyDoc, flush],
  );

  /** Texto puro na posição da seleção (colar e soltar): nunca HTML. */
  const insertPlain = useCallback(
    (text: string, at?: { start: number; end: number }) => {
      if (!text) return;
      const { start, end } = at ?? curSel();
      tryApply(replaceRange(docRef.current, start, end, text));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyDoc],
  );

  // beforeinput nativo: Enter, apagar entre blocos, colar, desfazer e formatação do sistema passam pelo modelo.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onBefore = (ev: Event) => {
      const e = ev as InputEvent;
      if (e.isComposing || composing.current) return;
      const t = e.inputType;
      const { start, end } = curSel();
      const doc = docRef.current;
      const take = () => e.preventDefault();
      if (t === "insertParagraph" || t === "insertLineBreak") {
        take();
        tryApply(insertNewline(doc, start, end));
      } else if (t === "insertFromPaste" || t === "insertFromDrop" || t === "insertFromYank" || t === "insertFromPasteAsQuotation") {
        take();
        insertPlain(e.dataTransfer?.getData("text/plain") ?? e.data ?? "");
      } else if (t === "insertText") {
        const a = locate(doc, start);
        const b = locate(doc, end);
        if (a.bi !== b.bi) {
          take();
          insertPlain(e.data ?? "");
        }
      } else if (t.startsWith("delete")) {
        const dir = t.includes("Forward") ? "fwd" : "back";
        const r = deleteStep(doc, start, end, dir);
        if (r) {
          take();
          tryApply(r);
        }
      } else if (t === "historyUndo") {
        take();
        doUndo();
      } else if (t === "historyRedo") {
        take();
        doRedo();
      } else if (t === "formatBold" || t === "formatItalic" || t === "formatUnderline" || t === "formatStrikeThrough") {
        take();
        inline(t === "formatBold" ? "b" : t === "formatItalic" ? "i" : t === "formatUnderline" ? "u" : "s");
      }
    };
    root.addEventListener("beforeinput", onBefore);
    return () => root.removeEventListener("beforeinput", onBefore);
    // handlers usam só refs e funções estáveis por render; reata a cada render para enxergar o estado atual
  });

  // Fecha o menu de estilo ao tocar fora dele.
  useEffect(() => {
    if (!menu.open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (document.getElementById(listId)?.contains(t) || styleBtnRef.current?.contains(t)) return;
      setMenu((m) => ({ ...m, open: false }));
    };
    // Escape fecha e devolve o foco ao botão, mesmo com o menu aberto por mouse/toque (sem foco na lista)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu((m) => ({ ...m, open: false }));
      styleBtnRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu.open, listId]);

  const shownKind: Kind = ui.kind === "li" ? "p" : ui.kind;
  useEffect(() => {
    if (menu.open && menu.byKeyboard) optionRefs.current[Math.max(0, MENU_KINDS.findIndex((m) => m.kind === shownKind))]?.focus();
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open]);

  const openMenu = (byKeyboard: boolean) => {
    const btn = styleBtnRef.current;
    const box = boxRef.current;
    const left = btn && box ? Math.max(8, btn.getBoundingClientRect().left - box.getBoundingClientRect().left) : 8;
    setMenu({ open: true, left, byKeyboard });
  };
  const closeMenu = (focusButton: boolean) => {
    setMenu((m) => ({ ...m, open: false }));
    if (focusButton) styleBtnRef.current?.focus();
  };
  const pick = (kind: Kind) => {
    setMenu((m) => ({ ...m, open: false }));
    chooseKind(kind);
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = optionRefs.current.findIndex((o) => o === document.activeElement);
    const go = (i: number) => optionRefs.current[(i + MENU_KINDS.length) % MENU_KINDS.length]?.focus();
    if (e.key === "ArrowDown") go(idx + 1);
    else if (e.key === "ArrowUp") go(idx - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(MENU_KINDS.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      if (idx >= 0) pick(MENU_KINDS[idx].kind);
    } else if (e.key === "Escape") closeMenu(true);
    else if (e.key === "Tab") closeMenu(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      b: () => inline("b"),
      i: () => inline("i"),
      u: () => inline("u"),
      z: e.shiftKey ? doRedo : doUndo,
      y: doRedo,
    };
    if (map[k]) {
      e.preventDefault();
      map[k]();
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // nada de HTML solto: só o texto puro, na posição onde soltou
    const text = e.dataTransfer.getData("text/plain");
    const root = rootRef.current;
    if (!text || !root) return;
    const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const p = d.caretPositionFromPoint?.(e.clientX, e.clientY);
    const node = p?.offsetNode ?? d.caretRangeFromPoint?.(e.clientX, e.clientY)?.startContainer;
    const off = p?.offset ?? d.caretRangeFromPoint?.(e.clientX, e.clientY)?.startOffset ?? 0;
    if (node && root.contains(node)) {
      document.getSelection()?.collapse(node, off);
      const o = getOffsets(root);
      if (o) insertPlain(text, o);
    } else insertPlain(text);
  };

  const left = NOTES_MAX - count;
  const nearLimit = left <= 500;
  const { flags } = ui;

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
      <div ref={boxRef} className="relative overflow-hidden rounded-[14px] border border-line bg-surface-solid focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
        <div
          role="toolbar"
          aria-label="Formatação do caderno"
          data-testid="notas-barra"
          className="flex items-center overflow-x-auto whitespace-nowrap border-b border-line bg-accent-soft/40 p-2"
          onMouseDown={(e) => {
            // mantém o foco e a seleção no texto (e o teclado do celular aberto) ao tocar na barra
            if (!(e.target instanceof HTMLElement && e.target.closest("[role=option]"))) e.preventDefault();
          }}
        >
          <button
            ref={styleBtnRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menu.open}
            aria-controls={menu.open ? listId : undefined}
            aria-label={`Estilo do texto: ${KIND_LABEL[shownKind]}`}
            className="relative inline-flex h-[34px] w-32 shrink-0 items-center justify-between gap-1.5 rounded-[10px] bg-accent-soft px-2.5 text-sm font-medium text-ink"
            onClick={(e) => (menu.open ? closeMenu(false) : openMenu(e.detail === 0))}
            onKeyDown={(e) => {
              if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menu.open) {
                e.preventDefault();
                openMenu(true);
              }
            }}
          >
            <TapArea />
            <span>{KIND_LABEL[shownKind]}</span>
            <ChevronDown size={16} className="text-muted" aria-hidden />
          </button>
          <Sep />
          <ToolButton label="Negrito" hint="Ctrl+B" icon={Bold} pressed={flags.includes("b")} onClick={() => inline("b")} />
          <ToolButton label="Itálico" hint="Ctrl+I" icon={Italic} pressed={flags.includes("i")} onClick={() => inline("i")} />
          <ToolButton label="Tachado" icon={Strikethrough} pressed={flags.includes("s")} onClick={() => inline("s")} />
          <ToolButton label="Sublinhado" hint="Ctrl+U" icon={Underline} pressed={flags.includes("u")} onClick={() => inline("u")} />
          <Sep />
          <ToolButton label="Marca-texto" icon={Highlighter} pressed={flags.includes("m")} onClick={() => inline("m")} />
          <ToolButton label="Lista" icon={List} pressed={ui.kind === "li"} onClick={list} />
          <Sep />
          <ToolButton label="Desfazer" hint="Ctrl+Z" icon={Undo2} disabled={!canUndo(history)} onClick={doUndo} />
          <ToolButton label="Refazer" hint="Ctrl+Shift+Z" icon={Redo2} disabled={!canRedo(history)} onClick={doRedo} />
        </div>
        {menu.open && (
          <div
            id={listId}
            role="listbox"
            aria-label="Estilo do texto"
            style={{ left: menu.left }}
            className="absolute top-[52px] z-10 w-[200px] overflow-hidden rounded-[14px] border border-line bg-surface-solid shadow-[0_10px_28px_rgba(40,90,190,0.18)]"
            onKeyDown={onMenuKey}
          >
            {MENU_KINDS.map((m, i) => (
              <div
                key={m.kind}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                role="option"
                tabIndex={-1}
                aria-selected={shownKind === m.kind}
                className={`flex h-11 cursor-pointer items-center justify-between px-3.5 outline-none hover:bg-accent-soft focus-visible:bg-accent-soft ${shownKind === m.kind ? "bg-accent-soft" : ""} ${m.cls}`}
                onClick={() => pick(m.kind)}
              >
                <span>{m.label}</span>
                {shownKind === m.kind && <Check size={16} className="text-primary" aria-hidden />}
              </div>
            ))}
          </div>
        )}
        <div
          ref={rootRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Anotações da aula"
          aria-describedby={counterId}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          autoCapitalize="sentences"
          data-testid="notas-editor"
          data-empty={empty}
          data-placeholder="O que você anotou na aula…"
          className="notes-editor"
          onKeyDown={onKeyDown}
          onInput={sync}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            sync();
          }}
          onPaste={(e) => {
            e.preventDefault(); // sempre texto puro: o HTML da área de transferência é descartado
            insertPlain(e.clipboardData.getData("text/plain"));
          }}
          onDragStart={(e) => e.preventDefault()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onBlur={() => void flush()}
        />
      </div>
      <p id={counterId} data-testid="notas-contador" role={limitMsg ? "alert" : undefined} className={`text-[12.5px] tabular-nums ${limitMsg || left <= 0 ? "text-danger" : nearLimit ? "text-ink" : "text-muted"}`}>
        {limitMsg ? `Limite de ${NOTES_MAX} caracteres: a nota ficou grande e o limite conta também os caracteres de formatação (marcas e barras de escape). ` : ""}
        {count}/{NOTES_MAX} caracteres (a marcação conta)
      </p>
    </section>
  );
}
