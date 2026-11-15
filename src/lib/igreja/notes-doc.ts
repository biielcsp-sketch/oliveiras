/**
 * Modelo do editor formatado do caderno: lista de blocos (parágrafo, título, subtítulo, item) com trechos
 * formatados. Funções puras, sem DOM real: a tela monta os elementos com createElement/textContent a partir
 * deste modelo e lê de volta por `domToDoc`. O que vai para o banco é sempre a marcação de notes-markup.ts
 * (`docToMarkup`), nunca HTML. Posições ("offsets") contam os caracteres de todos os blocos, com 1 a mais
 * entre um bloco e o próximo.
 */
import { NOTES_MAX, parseNotes, type InlineNode } from "./notes-markup";

export type Flag = "b" | "i" | "u" | "s" | "m";
export type Kind = "p" | "h1" | "h2" | "li";
/** `f`: letras das formatações do trecho, sempre na ordem de FLAG_ORDER. */
export type Run = { text: string; f: string };
export type DBlock = { k: Kind; runs: Run[] };
export type Doc = DBlock[];

/** Ordem de aninhamento: a primeira é a mais externa. */
export const FLAG_ORDER = "biusm";
/** Caractere invisível que segura o cursor dentro de uma formatação ainda sem texto (sai ao salvar). */
export const ZWSP = "​";

const sortF = (f: string) => [...FLAG_ORDER].filter((c) => f.includes(c)).join("");
const isZw = (r: Run) => r.text === ZWSP;
const emptyBlock = (k: Kind = "p"): DBlock => ({ k, runs: [] });

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
/** Texto vindo de fora (colado, solto, lido do DOM): sem controles, tab e NBSP viram espaço. */
export const cleanText = (t: string) => t.replace(/[\t ]/g, " ").replace(CTRL, "");

export function normRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && last.f === r.f && !isZw(last) && !isZw(r)) out[out.length - 1] = { text: last.text + r.text, f: r.f };
    else out.push({ text: r.text, f: r.f });
  }
  return out;
}

export const blockLen = (b: DBlock) => b.runs.reduce((n, r) => n + r.text.length, 0);
export const blockPlain = (b: DBlock) => b.runs.map((r) => r.text).join("");
export const docLength = (doc: Doc) => doc.reduce((n, b) => n + blockLen(b) + 1, -1);

/** Posição global → bloco e posição dentro dele (limitada ao documento). */
export function locate(doc: Doc, pos: number): { bi: number; off: number } {
  let rest = Math.max(0, pos);
  for (let bi = 0; bi < doc.length; bi++) {
    const len = blockLen(doc[bi]);
    if (rest <= len) return { bi, off: rest };
    rest -= len + 1;
  }
  const bi = doc.length - 1;
  return { bi, off: blockLen(doc[bi]) };
}
export function startOf(doc: Doc, bi: number): number {
  let n = 0;
  for (let i = 0; i < bi; i++) n += blockLen(doc[i]) + 1;
  return n;
}

function sliceRuns(runs: Run[], from: number, to: number): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const r of runs) {
    const a = Math.max(from, at);
    const b = Math.min(to, at + r.text.length);
    if (b > a) out.push({ text: r.text.slice(a - at, b - at), f: r.f });
    at += r.text.length;
  }
  return out;
}

/* ---------- Marcação -> modelo ---------- */

const NODE_FLAG = { b: "b", i: "i", u: "u", s: "s", mark: "m" } as const;

function flatten(nodes: InlineNode[], f: string, out: Run[]) {
  for (const n of nodes) {
    if (n.t === "text") out.push({ text: n.v, f });
    else flatten(n.c, sortF(f + NODE_FLAG[n.t]), out);
  }
}

export function markupToDoc(markup: string): Doc {
  const kinds = { p: "p", h: "h1", h2: "h2", li: "li" } as const;
  const doc = parseNotes(markup).map((b): DBlock => {
    if (b.t === "blank") return emptyBlock();
    const runs: Run[] = [];
    flatten(b.c, "", runs);
    return { k: kinds[b.t], runs: normRuns(runs) };
  });
  return doc.length ? doc : [emptyBlock()];
}

/* ---------- Modelo -> marcação ---------- */

const OPEN_I = ""; // marcadores internos do "_" (o texto nunca os contém: cleanText tira)
const CLOSE_I = "";
const MARK_TOKEN: Record<string, string> = { b: "**", i: "_", u: "++", s: "~~", m: "==" };

const isWordCh = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Escapa o texto: "\", "*", "+", "=", "~" sempre; "_" só se puder abrir/fechar (fora de palavra). */
function escapeText(t: string): string {
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" || c === "*" || c === "+" || c === "=" || c === "~") out += "\\" + c;
    else if (c === "_") out += isWordCh(t[i - 1]) && isWordCh(t[i + 1]) ? c : "\\_";
    else out += c;
  }
  return out;
}

/** Envolve com a marca, deixando os espaços das pontas do lado de fora (a marcação não aceita espaço junto à marca). */
function wrap(inner: string, flag: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (!m[2]) return inner;
  const tok = MARK_TOKEN[flag];
  return flag === "i" ? `${m[1]}${OPEN_I}${m[2]}${CLOSE_I}${m[3]}` : `${m[1]}${tok}${m[2]}${tok}${m[3]}`;
}

function emit(runs: Run[], depth: number): string {
  if (depth >= FLAG_ORDER.length) return runs.map((r) => escapeText(r.text)).join("");
  const flag = FLAG_ORDER[depth];
  let out = "";
  for (let i = 0; i < runs.length; ) {
    if (runs[i].f.includes(flag)) {
      let j = i;
      while (j < runs.length && runs[j].f.includes(flag)) j++;
      out += wrap(emit(runs.slice(i, j), depth + 1), flag);
      i = j;
    } else {
      let j = i;
      while (j < runs.length && !runs[j].f.includes(flag)) j++;
      out += emit(runs.slice(i, j), depth + 1);
      i = j;
    }
  }
  return out;
}

/** "_" só abre no começo de palavra e só fecha no fim: junto de letra, ganha o separador invisível "\|". */
function resolveItalics(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === OPEN_I) {
      out += (isWordCh(out[out.length - 1]) ? "\\|" : "") + "_";
    } else if (c === CLOSE_I) {
      let k = i + 1;
      while (s[k] === OPEN_I || s[k] === CLOSE_I) k++;
      out += "_" + (isWordCh(s[k]) ? "\\|" : "");
    } else out += c;
  }
  return out;
}

const PREFIX: Record<Kind, string> = { p: "", h1: "# ", h2: "## ", li: "- " };

const INTERNAL = /[\u200b\ue000\ue001]/g; // ZWSP do cursor e marcadores internos do "_": nunca vão para a marcação

/**
 * Marcação para salvar. Blocos vazios no FIM (item, título, subtítulo ou parágrafo sem texto) ficam de fora:
 * o servidor faz trim() e "- " viraria "-" (parágrafo) ao recarregar. O DOM do editor continua com o bloco vazio.
 */
export function docToMarkup(doc: Doc): string {
  let n = doc.length;
  while (n > 0 && doc[n - 1].runs.map((r) => r.text).join("").replace(INTERNAL, "").trim() === "") n--;
  return doc
    .slice(0, n)
    .map((b) => {
      const runs = normRuns(b.runs.map((r) => ({ text: r.text.replace(INTERNAL, ""), f: r.f })));
      const plain = runs.map((r) => r.text).join("");
      if (b.k === "p" && plain.trim() === "") return "";
      let line = resolveItalics(emit(runs, 0));
      // parágrafo que começa como título/lista: protege o primeiro caractere
      if (b.k === "p" && /^(#|##|-) /.test(line)) line = "\\" + line;
      return PREFIX[b.k] + line;
    })
    .join("\n");
}

/** Tamanho que o servidor vai contar. */
export const markupLength = (doc: Doc) => docToMarkup(doc).length;
export const fitsLimit = (doc: Doc, max = NOTES_MAX) => markupLength(doc) <= max;

/* ---------- Edição ---------- */

const nextKind = (k: Kind): Kind => (k === "li" ? "li" : "p");

/** Formatações do trecho: do caractere antes do cursor (ou do seguinte, no começo do bloco). Seleção: só as comuns a tudo. */
export function flagsAt(doc: Doc, start: number, end: number): string {
  if (end <= start) {
    const { bi, off } = locate(doc, start);
    const runs = doc[bi].runs;
    const r = sliceRuns(runs, Math.max(0, off - 1), off)[0] ?? sliceRuns(runs, off, off + 1)[0];
    return r?.f ?? "";
  }
  let common = null as string | null;
  const a = locate(doc, start);
  const b = locate(doc, end);
  for (let bi = a.bi; bi <= b.bi; bi++) {
    const from = bi === a.bi ? a.off : 0;
    const to = bi === b.bi ? b.off : blockLen(doc[bi]);
    for (const r of sliceRuns(doc[bi].runs, from, to)) {
      if (isZw(r)) continue;
      common = common === null ? r.f : [...common].filter((c) => r.f.includes(c)).join("");
    }
  }
  return common ?? "";
}

export function kindAt(doc: Doc, pos: number): Kind {
  return doc[locate(doc, pos).bi].k;
}

/** Troca o trecho [start, end) por `text` (que pode ter "\n"). Devolve o novo modelo e onde fica o cursor. */
export function replaceRange(doc: Doc, start: number, end: number, text: string): { doc: Doc; caret: number } {
  const total = docLength(doc);
  const s = Math.min(Math.max(0, start), total);
  const e = Math.min(Math.max(s, end), total);
  const a = locate(doc, s);
  const b = locate(doc, e);
  const blockA = doc[a.bi];
  const head = sliceRuns(blockA.runs, 0, a.off);
  const tail = sliceRuns(doc[b.bi].runs, b.off, blockLen(doc[b.bi]));
  const f = head.length ? head[head.length - 1].f : (sliceRuns(blockA.runs, a.off, a.off + 1)[0]?.f ?? "");
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(cleanText);
  const mk = (k: Kind, ...parts: Run[][]): DBlock => ({ k, runs: normRuns(parts.flat()) });
  const ins = (t: string): Run[] => (t ? [{ text: t, f }] : []);

  const mid: DBlock[] = [];
  let caretBi = a.bi;
  let caretOff: number;
  if (lines.length === 1) {
    mid.push(mk(blockA.k, head, ins(lines[0]), tail));
    caretOff = a.off + lines[0].length;
  } else {
    const k2 = nextKind(blockA.k);
    mid.push(mk(blockA.k, head, ins(lines[0])));
    for (let i = 1; i < lines.length - 1; i++) mid.push(mk(k2, ins(lines[i])));
    mid.push(mk(k2, ins(lines[lines.length - 1]), tail));
    caretBi = a.bi + lines.length - 1;
    caretOff = lines[lines.length - 1].length;
  }
  const out = [...doc.slice(0, a.bi), ...mid, ...doc.slice(b.bi + 1)];
  return { doc: out, caret: startOf(out, caretBi) + caretOff };
}

/** Enter: divide o bloco; em item de lista vazio, vira parágrafo. */
export function insertNewline(doc: Doc, start: number, end: number): { doc: Doc; caret: number } {
  const a = locate(doc, start);
  if (end <= start && doc[a.bi].k === "li" && blockPlain(doc[a.bi]).split(ZWSP).join("") === "") {
    const out = doc.map((b, i) => (i === a.bi ? { k: "p" as Kind, runs: [] } : b));
    return { doc: out, caret: startOf(out, a.bi) };
  }
  return replaceRange(doc, start, end, "\n");
}

/** Apagar com o teclado: quando o navegador faria uma bagunça (junta blocos), a gente decide. null = deixa o navegador. */
export function deleteStep(doc: Doc, start: number, end: number, dir: "back" | "fwd"): { doc: Doc; caret: number } | null {
  if (end > start) {
    const a = locate(doc, start);
    const b = locate(doc, end);
    return a.bi === b.bi ? null : replaceRange(doc, start, end, "");
  }
  const { bi, off } = locate(doc, start);
  if (dir === "back" && off === 0) {
    if (doc[bi].k !== "p") return { doc: doc.map((b, i) => (i === bi ? { ...b, k: "p" as Kind } : b)), caret: start };
    return bi === 0 ? null : replaceRange(doc, start - 1, start, "");
  }
  if (dir === "fwd" && off === blockLen(doc[bi])) return bi === doc.length - 1 ? null : replaceRange(doc, start, start + 1, "");
  return null;
}

/** Blocos tocados pela seleção (seleção que termina logo no começo de um bloco não puxa esse bloco). */
function blockRange(doc: Doc, start: number, end: number): [number, number] {
  const a = locate(doc, start);
  const b = locate(doc, end);
  return [a.bi, end > start && b.off === 0 && b.bi > a.bi ? b.bi - 1 : b.bi];
}

export function setKind(doc: Doc, start: number, end: number, kind: Kind): Doc {
  const [from, to] = blockRange(doc, start, end);
  return doc.map((b, i) => (i >= from && i <= to ? { ...b, k: kind } : b));
}

/** Lista: se todos os blocos tocados já são item, voltam a parágrafo; senão viram item. */
export function toggleList(doc: Doc, start: number, end: number): Doc {
  const [from, to] = blockRange(doc, start, end);
  const all = doc.slice(from, to + 1).every((b) => b.k === "li");
  return setKind(doc, start, end, all ? "p" : "li");
}

/** Liga/desliga uma formatação. Sem seleção, deixa um ZWSP formatado no cursor (o que for digitado já sai formatado). */
export function toggleFlag(doc: Doc, start: number, end: number, flag: Flag): { doc: Doc; start: number; end: number } {
  if (end <= start) {
    const { bi, off } = locate(doc, start);
    const runs = doc[bi].runs;
    const cur = flagsAt(doc, start, start);
    const next = cur.includes(flag) ? cur.replace(flag, "") : sortF(cur + flag);
    const before = sliceRuns(runs, Math.max(0, off - 1), off)[0];
    let newRuns: Run[];
    let caret = start;
    if (before && isZw(before)) {
      // já há um ZWSP logo antes do cursor: só troca as formatações dele
      newRuns = [...sliceRuns(runs, 0, off - 1), { text: ZWSP, f: next }, ...sliceRuns(runs, off, blockLen(doc[bi]))];
    } else {
      newRuns = [...sliceRuns(runs, 0, off), { text: ZWSP, f: next }, ...sliceRuns(runs, off, blockLen(doc[bi]))];
      caret = start + 1;
    }
    const out = doc.map((b, i) => (i === bi ? { ...b, runs: normRuns(newRuns) } : b));
    return { doc: out, start: caret, end: caret };
  }
  const on = !flagsAt(doc, start, end).includes(flag);
  const a = locate(doc, start);
  const b = locate(doc, end);
  const out = doc.map((blk, bi) => {
    if (bi < a.bi || bi > b.bi) return blk;
    const len = blockLen(blk);
    const from = bi === a.bi ? a.off : 0;
    const to = bi === b.bi ? b.off : len;
    const parts = [
      ...sliceRuns(blk.runs, 0, from),
      ...sliceRuns(blk.runs, from, to).map((r) => (isZw(r) ? r : { text: r.text, f: sortF(on ? r.f + flag : r.f.replace(flag, "")) })),
      ...sliceRuns(blk.runs, to, len),
    ];
    return { ...blk, runs: normRuns(parts) };
  });
  return { doc: out, start, end };
}

/* ---------- DOM -> modelo ---------- */

/** O mínimo que o leitor precisa de um nó (o Node do navegador serve; nos testes usamos objetos simples). */
export type DomNode = { nodeType: number; nodeName: string; nodeValue: string | null; childNodes: ArrayLike<DomNode>; getAttribute?: (n: string) => string | null };

const TAG_FLAG: Record<string, Flag> = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s", MARK: "m" };
const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "TABLE", "TR"]);
const KIND_ATTR: Record<string, Kind> = { p: "p", h1: "h1", h2: "h2", li: "li" };

/** Lê o conteúdo do editor. Só conta o texto e as tags de formatação conhecidas; estilos, atributos e tags estranhas são ignorados. */
export function domToDoc(root: DomNode): Doc {
  const doc: Doc = [];
  let cur: { k: Kind; runs: Run[] } | null = null;
  const flush = () => {
    if (cur) doc.push({ k: cur.k, runs: normRuns(cur.runs) });
    cur = null;
  };
  const inline = (n: DomNode, f: string, k: Kind) => {
    if (n.nodeType === 3) {
      const t = cleanText((n.nodeValue ?? "").replace(/[\r\n]+/g, " "));
      if (t) (cur ??= { k, runs: [] }).runs.push({ text: t, f });
      return;
    }
    if (n.nodeType !== 1) return;
    if (n.nodeName === "BR") return; // BR dentro de formatação: ignorado (os BR do bloco são tratados em `block`)
    if (BLOCK_TAGS.has(n.nodeName)) {
      if (cur && cur.runs.length) flush();
      else cur = null; // bloco ainda vazio que só envolvia outros blocos: não vira linha em branco
      const kk = KIND_ATTR[n.getAttribute?.("data-k") ?? ""] ?? (n.nodeName === "LI" ? "li" : k);
      block(n, f, kk);
      return;
    }
    const flag = TAG_FLAG[n.nodeName];
    const nf = flag && !f.includes(flag) ? sortF(f + flag) : f;
    for (let i = 0; i < n.childNodes.length; i++) inline(n.childNodes[i], nf, k);
  };
  const block = (el: DomNode, f: string, k: Kind) => {
    cur = { k, runs: [] };
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.nodeType === 1 && c.nodeName === "BR") {
        // BR seguido de mais conteúdo quebra o bloco; o BR final só segura a altura
        let more = false;
        for (let j = i + 1; j < kids.length; j++) if (kids[j].nodeType !== 1 || kids[j].nodeName !== "BR") more = true;
        if (more) {
          flush();
          k = nextKind(k);
          cur = { k, runs: [] };
        }
        continue;
      }
      inline(c, f, k);
    }
    flush();
  };
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.nodeType === 1 && BLOCK_TAGS.has(c.nodeName)) {
      flush();
      block(c, "", KIND_ATTR[c.getAttribute?.("data-k") ?? ""] ?? (c.nodeName === "LI" ? "li" : "p"));
    } else if (c.nodeType === 1 && c.nodeName === "BR") {
      flush();
      doc.push(emptyBlock());
    } else inline(c, "", "p");
  }
  flush();
  return doc.length ? doc : [emptyBlock()];
}
