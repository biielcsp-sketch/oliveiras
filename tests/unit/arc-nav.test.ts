import { describe, expect, it } from "vitest";
import { ARC_BASE_Y, activeRouteIndex, arcPlacement, clampIndex, dragToPosition, rootIndex } from "../../src/lib/arc-nav";

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

  it("no celular mostra o central e os vizinhos inteiros; os seguintes somem na borda", () => {
    expect(arcPlacement(0, 390).opacity).toBe(1);
    expect(arcPlacement(1, 390).opacity).toBe(1);
    const edge = arcPlacement(2, 390).opacity;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(arcPlacement(3, 390).opacity).toBe(0);
  });

  it("em tela larga mostra no máximo dois botões para cada lado", () => {
    expect(arcPlacement(2, 700).opacity).toBe(1);
    expect(arcPlacement(3, 700).opacity).toBe(0);
    expect(arcPlacement(-3, 700).opacity).toBe(0);
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
});
