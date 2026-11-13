import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { donutSlices } from "@/lib/financas/donut";
import { firstName, initials } from "@/lib/format";
import { MODULE_INFO, activeSectionIndex, moduleTopTitle } from "@/lib/module-sections";
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
  it("os módulos abrem na raiz (grade de seções), inclusive a Saúde", () => {
    expect(MODULES.every((m) => !m.entry)).toBe(true);
    expect(HOME_MODULES.map((m) => m.href)).toEqual(["/financas", "/saude", "/casa", "/ministerio"]);
  });
  it("todas as seções antigas da ferradura continuam acessíveis pela grade/⋮", () => {
    const hrefs = (k: keyof typeof MODULE_INFO) => MODULE_INFO[k].sections.map((s) => s.href);
    expect(hrefs("financas")).toEqual([
      "/financas/lancamentos",
      "/financas/orcamento",
      "/financas/contas-fixas",
      "/financas/documentos",
      "/financas/metas",
      "/financas/contas",
      "/financas/categorias",
      "/financas/open-finance",
    ]);
    expect(hrefs("saude")).toEqual(["/saude", "/saude/consultas", "/saude/exames", "/saude/procedimentos", "/saude/medicamentos", "/saude/vacinas"]);
    expect(hrefs("casa")).toEqual(
      expect.arrayContaining(["/casa/compras", "/casa/pet", "/casa/cardapio", "/casa/tarefas", "/casa/manutencao", "/casa/prestadores", "/casa/contas", "/casa/documentos"]),
    );
    expect(hrefs("casa")).not.toContain("/casa");
    expect(hrefs("ministerio")).toEqual(["/ministerio/devocional", "/ministerio/devocional/oracoes", "/ministerio/carisma", "/ministerio/consolidacao"]);
  });
  it("título do topo: módulo na raiz, seção nas páginas internas", () => {
    expect(moduleTopTitle(MODULE_INFO.financas, "/financas")).toBe("Finanças");
    expect(moduleTopTitle(MODULE_INFO.financas, "/financas/lancamentos/novo")).toBe("Lançamentos");
    expect(moduleTopTitle(MODULE_INFO.financas, "/financas/importar")).toBe("Finanças");
    expect(moduleTopTitle(MODULE_INFO.saude, "/saude")).toBe("Saúde");
    expect(moduleTopTitle(MODULE_INFO.saude, "/saude/vacinas")).toBe("Vacinas");
    expect(moduleTopTitle(MODULE_INFO.casa, "/casa/contas/documento/abc/apagar")).toBe("Contas");
    // A seção mais específica vence (Orações fica dentro de Devocional)
    expect(moduleTopTitle(MODULE_INFO.ministerio, "/ministerio/devocional/oracoes")).toBe("Orações");
    expect(moduleTopTitle(MODULE_INFO.ministerio, "/ministerio/devocional/promessas")).toBe("Devocional");
  });
  it("Carteirinhas (raiz da Saúde) só fica ativa na própria raiz", () => {
    const i = MODULE_INFO.saude.sections.findIndex((s) => s.key === "carteirinhas");
    expect(activeSectionIndex(MODULE_INFO.saude, "/saude")).toBe(i);
    expect(activeSectionIndex(MODULE_INFO.saude, "/saude/exames")).not.toBe(i);
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
