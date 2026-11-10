/** Geometria do menu em ferradura (src/components/arc-nav.tsx). Funções puras, testadas em tests/unit/arc-nav.test.ts. */

/** Distância, em px, entre dois botões vizinhos medida sobre o arco. */
export const ARC_SPACING = 104;
/** Raio do arco: quanto maior, mais suave a curva. */
export const ARC_RADIUS = 380;
/** Topo do botão central (o mais baixo do arco), em px. */
export const ARC_BASE_Y = 48;
/** Arraste horizontal, em px, que avança um botão. */
export const DRAG_PX_PER_ITEM = 95;

export function clampIndex(i: number, max: number) {
  return Math.max(0, Math.min(max, i));
}

/**
 * Posição de um botão a `offset` botões do centro.
 * x: deslocamento horizontal a partir do centro; y: topo do botão (pontas sobem);
 * opacity: some perto da borda do container de largura `width`.
 */
export function arcPlacement(offset: number, width: number) {
  const theta = (offset * ARC_SPACING) / ARC_RADIUS;
  const x = ARC_RADIUS * Math.sin(theta);
  const y = ARC_BASE_Y - ARC_RADIUS * (1 - Math.cos(theta));
  const half = width / 2;
  const edge = Math.max(0, Math.min(1, (half + 30 - Math.abs(x)) / 60));
  // No máximo dois botões para cada lado (em telas largas o arco subiria demais)
  const far = Math.max(0, Math.min(1, 3 - Math.abs(offset)));
  const opacity = Math.abs(theta) >= Math.PI / 2 ? 0 : Math.min(edge, far);
  return { x, y, opacity };
}

/** Posição durante o arraste, com resistência ao passar do primeiro ou do último botão. */
export function dragToPosition(start: number, dx: number, max: number) {
  const p = start - dx / DRAG_PX_PER_ITEM;
  if (p < 0) return p * 0.3;
  if (p > max) return max + (p - max) * 0.3;
  return p;
}

/**
 * Aba da rota atual. A aba raiz do módulo (cujo endereço é prefixo das outras, ex.: /financas) só casa exato,
 * esteja em qualquer posição do arco; as demais casam também subpáginas.
 * -1 quando a página não é de nenhuma aba (ex.: /financas/importar).
 */
export function activeRouteIndex(items: { href: string }[], path: string) {
  return items.findIndex((it) => {
    const isRoot = items.some((o) => o !== it && o.href.startsWith(it.href + "/"));
    return isRoot ? path === it.href : path === it.href || path.startsWith(it.href + "/");
  });
}
