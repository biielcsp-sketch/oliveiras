/**
 * Pontes entre o modelo do caderno (notes-doc.ts) e o DOM do editor, só no navegador.
 * O DOM é montado com createElement/createTextNode (texto do usuário nunca vai por innerHTML).
 */
import { type Doc, type Flag, FLAG_ORDER } from "./notes-doc";

const TAG: Record<string, string> = { b: "strong", i: "em", u: "u", s: "s", m: "mark" };

export function buildDom(root: HTMLElement, doc: Doc) {
  const frag = document.createDocumentFragment();
  for (const b of doc) {
    const el = document.createElement("div");
    el.setAttribute("data-k", b.k);
    for (const r of b.runs) {
      let node: Node = document.createTextNode(r.text);
      for (const flag of [...FLAG_ORDER].reverse()) {
        if (!r.f.includes(flag)) continue;
        const w = document.createElement(TAG[flag]);
        w.appendChild(node);
        node = w;
      }
      el.appendChild(node);
    }
    if (!b.runs.length) el.appendChild(document.createElement("br"));
    frag.appendChild(el);
  }
  root.replaceChildren(frag);
}

/** Posição global (ver notes-doc) de um ponto do DOM; blocos = filhos diretos da raiz. */
export function pointToOffset(root: HTMLElement, node: Node, off: number): number {
  const blocks = Array.from(root.children);
  let n = 0;
  if (node === root) {
    for (let i = 0; i < Math.min(off, blocks.length); i++) n += (blocks[i].textContent ?? "").length + 1;
    return n;
  }
  for (const blk of blocks) {
    if (blk.contains(node)) {
      const r = document.createRange();
      r.selectNodeContents(blk);
      r.setEnd(node, off);
      return n + r.toString().length;
    }
    n += (blk.textContent ?? "").length + 1;
  }
  return n;
}

function offsetToPoint(root: HTMLElement, pos: number): [Node, number] {
  const blocks = Array.from(root.children);
  let rest = Math.max(0, pos);
  for (let i = 0; i < blocks.length; i++) {
    const len = (blocks[i].textContent ?? "").length;
    if (rest <= len || i === blocks.length - 1) {
      const w = document.createTreeWalker(blocks[i], NodeFilter.SHOW_TEXT);
      let left = Math.min(rest, len);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const l = (t.nodeValue ?? "").length;
        if (left <= l) return [t, left];
        left -= l;
      }
      return [blocks[i], 0];
    }
    rest -= len + 1;
  }
  return [root, 0];
}

export function getOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const a = pointToOffset(root, sel.anchorNode, sel.anchorOffset);
  const b = pointToOffset(root, sel.focusNode, sel.focusOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function setOffsets(root: HTMLElement, start: number, end: number) {
  const sel = document.getSelection();
  if (!sel) return;
  const [an, ao] = offsetToPoint(root, start);
  const [fn, fo] = offsetToPoint(root, end);
  sel.setBaseAndExtent(an, ao, fn, fo);
}

/** Todo filho direto da raiz é um bloco simples (div[data-k] sem bloco dentro)? Senão a tela remonta a partir do modelo. */
export function isFlat(root: HTMLElement): boolean {
  if (!root.children.length || root.childNodes.length !== root.children.length) return false;
  return Array.from(root.children).every((c) => c.tagName === "DIV" && c.hasAttribute("data-k") && !c.querySelector("div,p,ul,ol,li,h1,h2,h3,br:not(:only-child)"));
}

export type { Flag };
