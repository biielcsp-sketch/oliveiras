/**
 * Caderno de anotações da aula: texto com marcação leve, guardado na coluna `notes` (texto puro).
 *   **negrito**  _itálico_  ++sublinhado++  ==marca-texto==  "# título"  "- item de lista"
 * Funções puras (sem DOM): o parser devolve uma árvore que o React renderiza como elementos (nunca HTML bruto),
 * então qualquer texto digitado (inclusive "<script>") sai escapado. Notas antigas, sem marcação, passam iguais.
 */

export const NOTES_MAX = 10000; // igual a IGREJA_LIMITS.lessonNotes e ao check do banco

/* ---------- Parser ---------- */

export type InlineNode = { t: "text"; v: string } | { t: "b" | "i" | "u" | "mark"; c: InlineNode[] };
export type Block = { t: "p" | "h" | "li"; c: InlineNode[] } | { t: "blank" };

type Mark = { open: string; close: string; node: "b" | "i" | "u" | "mark" };
const MARKS: Mark[] = [
  { open: "**", close: "**", node: "b" },
  { open: "++", close: "++", node: "u" },
  { open: "==", close: "==", node: "mark" },
  { open: "_", close: "_", node: "i" },
];

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * Abertura valida? O conteúdo não pode começar com espaço; "_" só abre no começo de palavra
 * (para "snake_case" e "a_b" ficarem como estão).
 */
function opens(s: string, i: number, m: Mark) {
  if (!s.startsWith(m.open, i)) return false;
  const next = s[i + m.open.length];
  if (next === undefined || /\s/.test(next)) return false;
  if (m.node === "i" && isWord(s[i - 1])) return false;
  if (m.node === "b" && s[i + 2] === "*") return false;
  return true;
}

/** Fechamento valido? Não pode vir depois de espaço; "_" só fecha no fim de palavra. */
function closes(s: string, j: number, m: Mark) {
  if (!s.startsWith(m.close, j)) return false;
  const prev = s[j - 1];
  if (prev === undefined || /\s/.test(prev)) return false;
  if (m.node === "i" && isWord(s[j + 1])) return false;
  return true;
}

export function parseInline(s: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  scan: while (i < s.length) {
    for (const m of MARKS) {
      if (!opens(s, i, m)) continue;
      for (let j = i + m.open.length + 1; j < s.length; j++) {
        if (closes(s, j, m)) {
          flush();
          out.push({ t: m.node, c: parseInline(s.slice(i + m.open.length, j)) });
          i = j + m.close.length;
          continue scan;
        }
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  return out;
}

/** Linhas viram blocos: "# " título, "- " item, linha vazia, ou parágrafo (a linha toda, espaços preservados). */
export function parseNotes(text: string): Block[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line): Block => {
      if (line.trim() === "") return { t: "blank" };
      if (line.startsWith("# ") && line.length > 2) return { t: "h", c: parseInline(line.slice(2)) };
      if (line.startsWith("- ") && line.length > 2) return { t: "li", c: parseInline(line.slice(2)) };
      return { t: "p", c: parseInline(line) };
    });
}

/** Texto sem a marcação (para o contador de palavras, busca etc.). */
export function stripMarkup(text: string): string {
  const plain = (nodes: InlineNode[]): string => nodes.map((n) => (n.t === "text" ? n.v : plain(n.c))).join("");
  return parseNotes(text)
    .map((b) => (b.t === "blank" ? "" : plain(b.c)))
    .join("\n");
}

/* ---------- Edição na seleção ---------- */

export type Sel = { text: string; start: number; end: number };
export type InlineKind = "bold" | "italic" | "underline" | "mark";
export type LineKind = "heading" | "list";

export const INLINE_MARKS: Record<InlineKind, string> = { bold: "**", italic: "_", underline: "++", mark: "==" };
export const LINE_PREFIX: Record<LineKind, string> = { heading: "# ", list: "- " };

/** A seleção está dentro da marcação (marcas logo fora dela ou nas pontas da própria seleção)? */
export function isWrapped(sel: Sel, kind: InlineKind): boolean {
  const m = INLINE_MARKS[kind];
  const { text, start, end } = sel;
  if (start >= m.length && text.slice(start - m.length, start) === m && text.slice(end, end + m.length) === m) {
    // "_" dentro de "__x__" (e "**" dentro de "***") não conta como a marca simples.
    if (kind === "italic" && (text[start - 2] === "_" || text[end + 1] === "_")) return false;
    return true;
  }
  const inner = text.slice(start, end);
  return inner.length >= m.length * 2 + 1 && inner.startsWith(m) && inner.endsWith(m);
}

/**
 * Liga/desliga a marcação na seleção. Sem seleção, insere o par e deixa o cursor no meio.
 * Passar de NOTES_MAX ao ligar → null (nada muda).
 */
export function toggleInline(sel: Sel, kind: InlineKind, max = NOTES_MAX): Sel | null {
  const m = INLINE_MARKS[kind];
  const { text, start, end } = sel;
  if (isWrapped(sel, kind)) {
    if (start >= m.length && text.slice(start - m.length, start) === m && text.slice(end, end + m.length) === m) {
      return { text: text.slice(0, start - m.length) + text.slice(start, end) + text.slice(end + m.length), start: start - m.length, end: end - m.length };
    }
    const inner = text.slice(start, end).slice(m.length, -m.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  const next = text.slice(0, start) + m + text.slice(start, end) + m + text.slice(end);
  if (next.length > max) return null;
  return { text: next, start: start + m.length, end: end + m.length };
}

/** Linhas tocadas pela seleção: [início da primeira, fim da última]. */
function lineRange(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", Math.max(0, start) - 1) + 1;
  // Seleção que termina logo depois de um "\n" não puxa a linha seguinte.
  const lastChar = end > start ? end - 1 : end;
  const nl = text.indexOf("\n", lastChar);
  return [from, nl === -1 ? text.length : nl] as const;
}

const anyPrefix = (l: string) => (l.startsWith("# ") ? "# " : l.startsWith("- ") ? "- " : "");

/** Todas as linhas tocadas pela seleção têm este prefixo? (aria-pressed de Título e Lista) */
export function hasLinePrefix(sel: Sel, kind: LineKind): boolean {
  const p = LINE_PREFIX[kind];
  const [from, to] = lineRange(sel.text, sel.start, sel.end);
  return sel.text.slice(from, to).split("\n").every((l) => l.startsWith(p));
}

/** Título/Lista: tira o prefixo se todas as linhas já o têm; senão põe (trocando o outro prefixo). */
export function toggleLinePrefix(sel: Sel, kind: LineKind, max = NOTES_MAX): Sel | null {
  const p = LINE_PREFIX[kind];
  const { text, start, end } = sel;
  const [from, to] = lineRange(text, start, end);
  const lines = text.slice(from, to).split("\n");
  const remove = lines.every((l) => l.startsWith(p));
  let delta0 = 0; // mudança de tamanho na primeira linha (ajusta o começo da seleção)
  let total = 0;
  const changed = lines.map((l, idx) => {
    const old = anyPrefix(l);
    const next = remove ? l.slice(p.length) : (l.trim() === "" && lines.length > 1 ? l : p + l.slice(old.length));
    const d = next.length - l.length;
    if (idx === 0) delta0 = d;
    total += d;
    return next;
  });
  const out = text.slice(0, from) + changed.join("\n") + text.slice(to);
  if (!remove && out.length > max) return null;
  return { text: out, start: Math.max(from, start + delta0), end: Math.max(from, end + total) };
}

/* ---------- Histórico (Desfazer/Refazer) ---------- */

export type HistoryEntry = { text: string; start: number; end: number };
export type History = { stack: HistoryEntry[]; index: number; at: number; typing: boolean };

export const HISTORY_LIMIT = 100;
/** Digitação seguida (menos que isso entre uma tecla e outra) vira um passo só do Desfazer. */
export const TYPING_GROUP_MS = 800;

export const newHistory = (text: string, now = 0): History => ({ stack: [{ text, start: text.length, end: text.length }], index: 0, at: now, typing: false });

/** Registra o novo estado. `group`: troca o passo atual em vez de empilhar (digitação contínua). */
export function pushHistory(h: History, e: HistoryEntry, now: number, group = false): History {
  const cur = h.stack[h.index];
  if (cur.text === e.text) return { ...h, stack: [...h.stack.slice(0, h.index), e, ...h.stack.slice(h.index + 1)] };
  const base = h.stack.slice(0, h.index + 1);
  if (group && h.typing && now - h.at < TYPING_GROUP_MS && h.index > 0) base[base.length - 1] = e;
  else base.push(e);
  const stack = base.length > HISTORY_LIMIT ? base.slice(base.length - HISTORY_LIMIT) : base;
  return { stack, index: stack.length - 1, at: now, typing: group };
}

export const canUndo = (h: History) => h.index > 0;
export const canRedo = (h: History) => h.index < h.stack.length - 1;
export const undo = (h: History): History => (canUndo(h) ? { ...h, index: h.index - 1 } : h);
export const redo = (h: History): History => (canRedo(h) ? { ...h, index: h.index + 1 } : h);
