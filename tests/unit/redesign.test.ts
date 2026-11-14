import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { donutSlices } from "@/lib/financas/donut";
import { firstName, initials } from "@/lib/format";
import { ARC_BASE_Y, activeRouteIndex, arcTrackPath, rootIndex } from "@/lib/arc-nav";
import { FINANCAS_TABS } from "@/lib/financas/nav";
import { SAUDE_TABS } from "@/lib/saude/nav";
import { CASA_TABS } from "@/lib/casa/nav";
import { IGREJA_TABS } from "@/lib/igreja/nav";
import { btnSize } from "@/components/ui";
import { ASSISTANT, HOME_MODULES, MOBILE_NAV_LEFT, MOBILE_NAV_RIGHT, MODULES, SIDEBAR_NAV } from "@/lib/modules";
import { THEME_COLOR } from "@/lib/theme";

describe("donut de despesas por categoria", () => {
  const name = (id: string | null) => (id ? `Cat ${id}` : "Sem categoria");

  it("sem gastos não desenha fatias", () => {
    expect(donutSlices([], name)).toEqual([]);
    expect(donutSlices([{ category_id: "a", total: 0 }], name)).toEqual([]);
  });

  it("porcentagens somam 100 e os deslocamentos encadeiam as fatias", () => {
    const s = donutSlices(
      [
        { category_id: "a", total: 100 },
        { category_id: "b", total: 100 },
        { category_id: "c", total: 100 },
      ],
      name,
    );
    expect(s.map((x) => x.pct).reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.map((x) => x.pct).sort()).toEqual([33, 33, 34]);
    expect(s[0].offset).toBe(0);
    expect(s[1].offset).toBe(-s[0].pct);
    expect(s[2].offset).toBe(-(s[0].pct + s[1].pct));
    expect(s[0].dash).toBe(`${s[0].pct} ${100 - s[0].pct}`);
  });

  it("as 4 maiores ganham fatia própria e o resto vira Outros (com o total somado)", () => {
    const s = donutSlices(
      [
        { category_id: "a", total: 500 },
        { category_id: "b", total: 200 },
        { category_id: null, total: 100 },
        { category_id: "d", total: 100 },
        { category_id: "e", total: 60 },
        { category_id: "f", total: 40 },
      ],
      name,
    );
    expect(s.map((x) => x.label)).toEqual(["Cat a", "Cat b", "Sem categoria", "Cat d", "Outros"]);
    expect(s[4]).toMatchObject({ key: "outros", total: 100, pct: 10 });
    expect(s[2]).toMatchObject({ key: "sem", categoryId: null });
    expect(s.map((x) => x.pct).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("com só uma categoria a mais que o limite, mostra todas (sem 'Outros' de um item só)", () => {
    const s = donutSlices(
      ["a", "b", "c", "d", "e"].map((id) => ({ category_id: id, total: 10 })),
      name,
    );
    expect(s).toHaveLength(5);
    expect(s.some((x) => x.key === "outros")).toBe(false);
  });
});

describe("nome e iniciais", () => {
  it("primeiro nome para a saudação", () => {
    expect(firstName("Gabriel Oliveira Rodrigues")).toBe("Gabriel");
    expect(firstName("  Karen  ")).toBe("Karen");
    expect(firstName(null)).toBe("");
    expect(firstName("")).toBe("");
  });
  it("iniciais do avatar: primeira e última palavra", () => {
    expect(initials("Gabriel Oliveira Rodrigues")).toBe("GR");
    expect(initials("ângela")).toBe("Â");
    expect(initials("")).toBe("?");
    expect(initials(undefined)).toBe("?");
  });
});

describe("navegação do redesign", () => {
  it("o Oli tem tela própria e fica no centro da barra inferior", () => {
    expect(ASSISTANT.href).toBe("/assistente");
    expect([...MOBILE_NAV_LEFT, ...MOBILE_NAV_RIGHT].map((m) => m.label)).toEqual(["Finanças", "Saúde", "Casa", "Igreja"]);
    expect(SIDEBAR_NAV.map((m) => m.href)).toContain("/assistente");
  });
  it("os módulos abrem na raiz, inclusive a Saúde (Carteirinhas no centro da ferradura)", () => {
    expect(MODULES.every((m) => !m.entry)).toBe(true);
    // Arco do Início com 5 itens: a Agenda entra no meio (saiu do topo no celular)
    expect(HOME_MODULES.map((m) => m.href)).toEqual(["/financas", "/saude", "/agenda", "/casa", "/ministerio"]);
  });
  it("ferradura de volta: todas as seções de cada módulo estão nas abas", () => {
    expect(FINANCAS_TABS.map((t) => t.href)).toEqual([
      "/financas/lancamentos",
      "/financas/orcamento",
      "/financas",
      "/financas/contas-fixas",
      "/financas/documentos",
      "/financas/metas",
      "/financas/contas",
      "/financas/categorias",
      "/financas/open-finance",
    ]);
    expect(SAUDE_TABS.map((t) => t.href)).toEqual(["/saude", "/saude/consultas", "/saude/exames", "/saude/procedimentos", "/saude/medicamentos", "/saude/vacinas"]);
    expect(CASA_TABS.map((t) => t.href)).toEqual(
      expect.arrayContaining(["/casa", "/casa/compras", "/casa/pet", "/casa/cardapio", "/casa/tarefas", "/casa/manutencao", "/casa/prestadores", "/casa/contas", "/casa/documentos"]),
    );
    expect(IGREJA_TABS.map((t) => t.href)).toEqual(["/ministerio/devocional", "/ministerio", "/ministerio/carisma", "/ministerio/consolidacao"]);
  });
  it("raiz de cada módulo abre no centro da ferradura (Resumo; Carteirinhas na Saúde)", () => {
    expect(FINANCAS_TABS[rootIndex(FINANCAS_TABS)].key).toBe("resumo");
    expect(CASA_TABS[rootIndex(CASA_TABS)].key).toBe("resumo");
    expect(IGREJA_TABS[rootIndex(IGREJA_TABS)].key).toBe("resumo");
    expect(SAUDE_TABS[activeRouteIndex(SAUDE_TABS, "/saude")].key).toBe("carteirinhas");
    expect(activeRouteIndex(SAUDE_TABS, "/saude/exames")).toBe(2);
    expect(FINANCAS_TABS[activeRouteIndex(FINANCAS_TABS, "/financas/lancamentos/novo")].key).toBe("lancamentos");
    // Página fora das abas: nenhuma marcada (a raiz fica no centro)
    expect(activeRouteIndex(FINANCAS_TABS, "/financas/importar")).toBe(-1);
  });
  it("trilho de luz passa pelo centro das bolhas: mais baixo no meio, simétrico nas pontas", () => {
    const pts = arcTrackPath(390, 35, 2)
      .split(/[ML]/)
      .filter(Boolean)
      .map((p) => p.trim().split(" ").map(Number));
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBe(0);
    expect(pts[2][0]).toBe(390);
    expect(pts[1]).toEqual([195, ARC_BASE_Y + 35]);
    expect(pts[0][1]).toBeLessThan(pts[1][1]);
    expect(pts[0][1]).toBeCloseTo(pts[2][1]);
  });
});

describe("visual leve (rodada 2)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const block = (name: string) => {
    const a = css.indexOf(`@utility ${name} {`);
    return css.slice(a, css.indexOf("\n}", a));
  };
  it("bolhas do arco/ferradura: borda fina, sem faixa de brilho nem reflexo", () => {
    const orb = block("glass-orb");
    expect(orb).toMatch(/border: 1px solid/);
    expect(orb).not.toContain("::before");
    expect(orb).not.toContain("::after");
  });
  it("primário sem faixa de brilho; topo sem botão de agenda; tema à esquerda e logo no centro", () => {
    expect(block("glass-primary")).not.toContain("::before");
    const head = readFileSync("src/components/head-bar.tsx", "utf8");
    expect(head).not.toMatch(/AgendaCalendarButton|CalendarDays/);
    expect(head.indexOf("ThemeToggle className")).toBeLessThan(head.indexOf("<Logo"));
    expect(head.indexOf("<Logo")).toBeLessThan(head.indexOf('aria-label="Família"'));
    expect(head).toMatch(/size-9/);
    expect(head).toMatch(/<TapArea \/>/);
  });
  it("ferradura: item selecionado com contorno fino e trilho fino", () => {
    const arc = readFileSync("src/components/arc-nav.tsx", "utf8");
    expect(arc).toContain("outline-[1.5px]");
    expect(arc).not.toContain("feGaussianBlur");
  });
});

describe("botões compactos", () => {
  it("altura visual sm 34px, md 40px, lg 44px; fonte 13/14px", () => {
    expect(btnSize.sm).toMatch(/\bh-\[34px\]/);
    expect(btnSize.sm).toContain("text-[13px]");
    expect(btnSize.md).toMatch(/\bh-10\b/);
    expect(btnSize.md).toContain("text-sm");
    expect(btnSize.lg).toMatch(/\bh-11\b/);
    expect(btnSize.lg).toContain("text-sm");
    expect(btnSize.icon).toContain("size-11");
  });
  it("área de toque invisível de 44px dentro do botão; o primário não corta essa área", () => {
    const ui = readFileSync("src/components/ui.tsx", "utf8");
    expect(ui).toMatch(/min-h-11 w-full min-w-11/);
    expect((ui.match(/<TapArea \/>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const css = readFileSync("src/app/globals.css", "utf8");
    const primary = css.slice(css.indexOf("@utility glass-primary"), css.indexOf("@utility card-hero"));
    expect(primary).not.toContain("overflow: hidden");
  });
});

describe("tokens e esfera do Oli (globals.css)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const light = css.match(/:root \{([\s\S]*?)\n\}/)![1];
  it("paleta clara aprovada", () => {
    for (const [k, v] of Object.entries({
      "--primary": "#0a5cc8",
      "--deep": "#023a90",
      "--secondary": "#3271d1",
      "--soft": "#dce8fe",
      "--bg": "#eef3fd",
      "--ink": "#0f1b3d",
      "--muted": "#5a6683",
      "--line": "#e1e8f5",
      "--success": "#1e7f3c",
      "--danger": "#c23b3c",
    })) {
      expect(light).toContain(`${k}: ${v};`);
    }
  });
  it("cor da barra do navegador acompanha o fundo de cada tema", () => {
    expect(light).toContain(`--bg: ${THEME_COLOR.light};`);
    expect(css).toContain(`--bg: ${THEME_COLOR.dark};`);
  });
  it("esfera animada com as 4 animações e parada com movimento reduzido", () => {
    for (const k of ["oliA", "oliB", "oliC", "oliBreath"]) expect(css).toContain(`@keyframes ${k}`);
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.oli,\s*\.oli\[data-state\],\s*\.oli \.w1,\s*\.oli \.w2,\s*\.oli \.w3 \{\s*animation: none;/);
  });
  it("antigo azul-petróleo não volta", () => {
    expect(css.toLowerCase()).not.toContain("#0b4a6b");
  });
});
