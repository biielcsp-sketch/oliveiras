import { describe, expect, it } from "vitest";
import { ARC_BASE_Y, activeRouteIndex, arcPlacement, clampIndex, dragToPosition, nearestPosition, rootIndex, wrapIndex, wrapOffset } from "../../src/lib/arc-nav";

describe("menu em ferradura", () => {
  it("botão central fica no ponto mais baixo e as pontas sobem simetricamente", () => {
    const c = arcPlacement(0, 390);
    const l = arcPlacement(-1, 390);
    const r = arcPlacement(1, 390);
    expect(c.x).toBe(0);
    expect(c.y).toBe(ARC_BASE_Y);
    expect(l.y).toBeLessThan(c.y);
    expect(r.y).toBeCloseTo(l.y);
    expect(r.x).toBeCloseTo(-l.x);
    expect(arcPlacement(2, 390).y).toBeLessThan(r.y);
  });

  it("mostra só 3 botões: o central e um vizinho de cada lado, inteiros; os seguintes ficam invisíveis", () => {
    for (const w of [360, 390, 700]) {
      expect(arcPlacement(0, w).opacity).toBe(1);
      expect(arcPlacement(1, w).opacity).toBe(1);
      expect(arcPlacement(-1, w).opacity).toBe(1);
      expect(arcPlacement(2, w).opacity).toBe(0);
      expect(arcPlacement(-2, w).opacity).toBe(0);
      expect(arcPlacement(3, w).opacity).toBe(0);
    }
  });

  it("no celular os vizinhos cabem inteiros na tela (bolha de 96px de largura de item)", () => {
    const x = arcPlacement(1, 360).x;
    expect(180 + x + 48).toBeLessThanOrEqual(360);
  });

  it("durante o arraste o próximo botão aparece aos poucos", () => {
    const o = arcPlacement(1.5, 390).opacity;
    expect(o).toBeGreaterThan(0);
    expect(o).toBeLessThan(1);
  });

  it("arrastar para a esquerda avança e há resistência nas pontas", () => {
    expect(dragToPosition(0, -95, 5)).toBeCloseTo(1);
    expect(dragToPosition(0, 95, 5)).toBeCloseTo(-0.3);
    expect(dragToPosition(5, -95, 5)).toBeCloseTo(5.3);
  });

  it("índice fica dentro das abas", () => {
    expect(clampIndex(-1, 4)).toBe(0);
    expect(clampIndex(7, 4)).toBe(4);
    expect(clampIndex(2, 4)).toBe(2);
  });

  it("aba ativa pela rota: raiz só exata, demais com subpáginas", () => {
    const tabs = [{ href: "/financas" }, { href: "/financas/lancamentos" }, { href: "/financas/contas" }];
    expect(activeRouteIndex(tabs, "/financas")).toBe(0);
    expect(activeRouteIndex(tabs, "/financas/lancamentos/novo")).toBe(1);
    expect(activeRouteIndex(tabs, "/financas/contas")).toBe(2);
    expect(activeRouteIndex(tabs, "/financas/contas-fixas")).toBe(-1);
    expect(activeRouteIndex(tabs, "/financas/importar")).toBe(-1);
  });

  it("aba raiz no meio do arco continua casando só a rota exata", () => {
    const tabs = [{ href: "/financas/lancamentos" }, { href: "/financas/orcamento" }, { href: "/financas" }, { href: "/financas/metas" }];
    expect(activeRouteIndex(tabs, "/financas")).toBe(2);
    expect(activeRouteIndex(tabs, "/financas/metas/nova")).toBe(3);
    expect(activeRouteIndex(tabs, "/financas/importar")).toBe(-1);
    // Fora das abas, o centro volta para o Resumo (raiz), não para a primeira da lista
    expect(rootIndex(tabs)).toBe(2);
  });

  it("circular: a primeira aba tem a última como vizinha à esquerda (sempre 3 visíveis, inclusive nas pontas)", () => {
    const n = 7; // Saúde
    const visible = (pos: number) =>
      Array.from({ length: n }, (_, i) => i).filter((i) => arcPlacement(wrapOffset(i, pos, n), 390).opacity > 0.5);
    expect(visible(0)).toEqual([0, 1, 6]); // Resumo no meio, Vacinas à esquerda, Carteirinhas à direita
    expect(wrapOffset(6, 0, n)).toBe(-1);
    expect(visible(6)).toEqual([0, 5, 6]); // última aba: Medicamentos, Vacinas, Resumo
    expect(wrapOffset(0, 6, n)).toBe(1);
    for (const n2 of [4, 5, 6, 9]) for (let p = 0; p < n2; p++) expect(Array.from({ length: n2 }, (_, i) => arcPlacement(wrapOffset(i, p, n2), 390).opacity > 0.5).filter(Boolean)).toHaveLength(3);
  });

  it("circular: índice dá a volta e o arco gira pelo lado mais curto", () => {
    expect(wrapIndex(-1, 6)).toBe(5);
    expect(wrapIndex(6, 6)).toBe(0);
    expect(wrapIndex(13, 6)).toBe(1);
    // da primeira (pos 0) para a última: um passo para a esquerda, não 5 para a direita
    expect(nearestPosition(5, 0, 6)).toBe(-1);
    // de uma posição já "girada" (pos 6 = aba 0) para a aba 1: um passo
    expect(nearestPosition(1, 6, 6)).toBe(7);
    expect(nearestPosition(3, 3, 6)).toBe(3);
  });
});

