/**
 * Caderno de anotações da aula: texto com marcação leve, guardado na coluna `notes` (texto puro).
 *   **negrito**  _itálico_  ++sublinhado++  ~~tachado~~  ==marca-texto==
 *   "# título"  "## subtítulo"  "- item de lista"
 * Escape: "\" antes de * _ + = ~ # - \ vale como o próprio caractere; "\|" é um separador invisível.
 * Funções puras (sem DOM): o parser devolve uma árvore que o React renderiza como elementos (nunca HTML bruto),
 * então qualquer texto digitado (inclusive "<script>") sai escapado. Notas antigas, sem marcação, passam iguais.
 * O editor formatado (notes-doc.ts) lê e grava esta mesma marcação.
 */

export const NOTES_MAX = 10000; // igual a IGREJA_LIMITS.lessonNotes e ao check do banco

/* ---------- Parser ---------- */

export type InlineNode = { t: "text"; v: string } | { t: "b" | "i" | "u" | "s" | "mark"; c: InlineNode[] };
export type Block = { t: "p" | "h" | "h2" | "li"; c: InlineNode[] } | { t: "blank" };

type Mark = { open: string; close: string; node: "b" | "i" | "u" | "s" | "mark" };
const MARKS: Mark[] = [
  { open: "**", close: "**", node: "b" },
  { open: "++", close: "++", node: "u" },
  { open: "~~", close: "~~", node: "s" },
  { open: "==", close: "==", node: "mark" },
  { open: "_", close: "_", node: "i" },
];

/** Caracteres que o "\\" protege; "|" é o separador invisível (vira nada). */
export const ESCAPABLE = "\\*_+=~#-|";
/** Posição precedida por número ímpar de "\\" (escapada). */
function isEscaped(s: string, i: number) {
  let n = 0;
  while (i - 1 - n >= 0 && s[i - 1 - n] === "\\") n++;
  return n % 2 === 1;
}

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
  if (!s.startsWith(m.close, j) || isEscaped(s, j)) return false;
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
    if (s[i] === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      if (s[i + 1] !== "|") buf += s[i + 1];
      i += 2;
      continue;
    }
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

/** Linhas viram blocos: "# " título, "## " subtítulo, "- " item, linha vazia, ou parágrafo (a linha toda, espaços preservados). */
export function parseNotes(text: string): Block[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line): Block => {
      if (line.trim() === "") return { t: "blank" };
      if (line.startsWith("# ")) return { t: "h", c: parseInline(line.slice(2)) };
      if (line.startsWith("## ")) return { t: "h2", c: parseInline(line.slice(3)) };
      if (line.startsWith("- ")) return { t: "li", c: parseInline(line.slice(2)) };
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
