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
import { isPetAlert, petAlertRank, petTileLines, tileRows } from "@/lib/summary-tile";
import { ASSISTANT, HOME_MODULES, MOBILE_NAV_LEFT, MOBILE_NAV_RIGHT, MODULES, SIDEBAR_NAV } from "@/lib/modules";
import { THEME_COLOR } from "@/lib/theme";
import { HOME_PANELS, HOME_PANEL_INFO, homePanelAt, initialHomeIndex, nextAgendaEvents, nextHealthItems } from "@/lib/home-panels";
import type { AgendaEvent } from "@/lib/agenda/view";
import type { HealthAppointment } from "@/lib/saude/types";

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
  it("os módulos abrem na raiz, inclusive a Saúde (Resumo no centro da ferradura)", () => {
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
    expect(SAUDE_TABS.map((t) => t.href)).toEqual(["/saude", "/saude/carteirinhas", "/saude/consultas", "/saude/exames", "/saude/procedimentos", "/saude/medicamentos", "/saude/vacinas"]);
    expect(CASA_TABS.map((t) => t.href)).toEqual(
      expect.arrayContaining(["/casa", "/casa/compras", "/casa/pet", "/casa/cardapio", "/casa/tarefas", "/casa/manutencao", "/casa/prestadores", "/casa/contas", "/casa/documentos"]),
    );
    expect(IGREJA_TABS.map((t) => t.href)).toEqual(["/ministerio/devocional", "/ministerio", "/ministerio/carisma", "/ministerio/consolidacao"]);
  });
  it("raiz de cada módulo abre no centro da ferradura (Resumo, inclusive na Saúde)", () => {
    expect(FINANCAS_TABS[rootIndex(FINANCAS_TABS)].key).toBe("resumo");
    expect(CASA_TABS[rootIndex(CASA_TABS)].key).toBe("resumo");
    expect(IGREJA_TABS[rootIndex(IGREJA_TABS)].key).toBe("resumo");
    expect(SAUDE_TABS[rootIndex(SAUDE_TABS)].key).toBe("resumo");
    expect(SAUDE_TABS[activeRouteIndex(SAUDE_TABS, "/saude")].key).toBe("resumo");
    expect(SAUDE_TABS[activeRouteIndex(SAUDE_TABS, "/saude/carteirinhas")].key).toBe("carteirinhas");
    expect(activeRouteIndex(SAUDE_TABS, "/saude/exames")).toBe(3);
    // Telas de exames de laboratório não são abas: o Resumo (raiz) fica no centro; "exames-lab" não casa com "exames"
    for (const p of ["/saude/evolucao", "/saude/evolucao/colesterol-ldl", "/saude/orientacoes", "/saude/exames-lab/enviar"]) expect(activeRouteIndex(SAUDE_TABS, p)).toBe(-1);
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
  it("bolhas do arco/ferradura: vidro fosco com borda fina clara, reflexo suave no topo e sem reflexo embaixo", () => {
    const orb = block("glass-orb");
    expect(orb).toMatch(/border: 1px solid rgb\(255 255 255 \/ 0\.4\d?\)/);
    expect(orb).toMatch(/backdrop-filter: blur\(/);
    expect(orb).toContain("::before");
    expect(orb).not.toContain("::after");
    const alpha = Number(orb.match(/::before[\s\S]*?rgb\(255 255 255 \/ (0\.\d+)\)/)![1]);
    expect(alpha).toBeLessThanOrEqual(0.35);
  });
  it("cards de resumo: mesma altura fixa, conteúdo centralizado e subtítulo em até 2 linhas", () => {
    const home = readFileSync("src/components/module-home.tsx", "utf8");
    const tile = home.slice(home.indexOf("export function SummaryTile"));
    expect(tile).toMatch(/h-\[88px\] items-center/);
    // Alertas podem ocupar até 2 linhas; o resto corta em 1 linha (cabe tudo nos 88px)
    expect(tile).toContain('"line-clamp-2 font-medium text-danger"');
    expect(tile).toContain('"truncate text-muted"');
    expect(tile).toContain("tileRows(lines, isAlert, alertRank)");
    // Casa e Igreja montam os cards num componente só (usado também no painel do Início)
    for (const comp of ["src/app/(app)/casa/_components/resumo-tiles.tsx", "src/app/(app)/ministerio/_components/resumo-tiles.tsx"]) {
      const src = readFileSync(comp, "utf8");
      expect(src).toContain("<SummaryTile");
      expect(src).toContain("auto-rows-fr");
    }
  });
  it("Início usa a ferradura deslizante só de atalhos, começando na Agenda", () => {
    const arc = readFileSync("src/components/home-arc.tsx", "utf8");
    expect(arc).toContain("slideOnly");
    expect(arc).toContain("onCenter={setIndex}");
    expect(HOME_PANELS[initialHomeIndex(false)]).toBe("agenda");
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

describe("linhas do card de resumo (tileRows)", () => {
  it("Pet: alertas (cuidados vencidos e ração acabando) vão para a linha 1, antes da próxima dose longa", () => {
    const lines = ["Próxima dose: Moisés: Vacina V10 - Reforço anual com nome comprido (em 3 dias)", "2 cuidados vencidos", "Ração acabando"];
    const rows = tileRows(lines, isPetAlert);
    expect(rows).toEqual(["2 cuidados vencidos · Ração acabando", "Próxima dose: Moisés: Vacina V10 - Reforço anual com nome comprido (em 3 dias)"]);
  });
  it("Pet sem alerta: 0 cuidados vencidos não é alerta; a próxima dose fica na linha 1", () => {
    expect(tileRows(["Próxima dose: Vacina V10 (em 3 dias)", "0 cuidados vencidos"], isPetAlert)).toEqual([
      "Próxima dose: Vacina V10 (em 3 dias)",
      "0 cuidados vencidos",
    ]);
    expect(isPetAlert("1 cuidado vencido")).toBe(true);
    expect(isPetAlert("Ração acabando: Moisés, Bob")).toBe(true);
  });
  it("Pet: dose atrasada vira alerta com o status antes do nome (o atraso não some no corte)", () => {
    const lines = petTileLines(["Próxima dose: Vacina V10 - Reforço (atrasada há 3 dias)", "0 cuidados vencidos"]);
    expect(lines).toEqual(["Dose atrasada há 3 dias: Vacina V10 - Reforço", "0 cuidados vencidos"]);
    expect(isPetAlert(lines[0])).toBe(true);
    expect(tileRows(lines, isPetAlert)[0]).toBe("Dose atrasada há 3 dias: Vacina V10 - Reforço");
    // Com o nome do pet (vários pets) e 1 dia
    expect(petTileLines(["Próxima dose: Moisés: Vacina V10 (atrasada há 1 dia)"])).toEqual(["Dose atrasada há 1 dia: Moisés: Vacina V10"]);
    // Dose no prazo continua igual e não é alerta
    expect(petTileLines(["Próxima dose: Vacina V10 (em 3 dias)"])).toEqual(["Próxima dose: Vacina V10 (em 3 dias)"]);
    expect(isPetAlert("Próxima dose: Vacina V10 (em 3 dias)")).toBe(false);
  });
  it("Pet com os três alertas juntos: curtos primeiro (cuidados vencidos, ração), dose atrasada (nome livre) por último", () => {
    const lines = petTileLines(["Próxima dose: Vacina Antirrábica com nome bem comprido (atrasada há 35 dias)", "2 cuidados vencidos", "Ração acabando"]);
    const rows = tileRows(lines, isPetAlert, petAlertRank);
    expect(rows).toEqual(["2 cuidados vencidos · Ração acabando · Dose atrasada há 35 dias: Vacina Antirrábica com nome bem comprido"]);
    expect(rows[0].indexOf("2 cuidados vencidos")).toBe(0);
    expect(rows[0].indexOf("Ração acabando")).toBeLessThan(rows[0].indexOf("Dose atrasada"));
    // Sem rank, a ordem original (dose primeiro) seria mantida — o rank é que garante os curtos à frente
    expect(tileRows(lines, isPetAlert)[0].startsWith("Dose atrasada")).toBe(true);
  });
  it("Carisma: próxima e última aula ficam cada uma na sua linha (nenhuma some)", () => {
    expect(tileRows(["Próxima aula: 20/11/2026 · Eclesiologia", "Última aula: 13/11/2026 · Hermenêutica"])).toEqual([
      "Próxima aula: 20/11/2026 · Eclesiologia",
      "Última aula: 13/11/2026 · Hermenêutica",
    ]);
  });
  it("no máximo 2 linhas; o excedente vai junto na linha 2", () => {
    expect(tileRows(["a", "b", "c"])).toEqual(["a", "b · c"]);
    expect(tileRows(["só uma"])).toEqual(["só uma"]);
  });
});

describe("cabeçalhos: mesma onda e sem a setinha", () => {
  it("Início e módulos usam o mesmo fundo/onda (HeroBackground) e a mesma altura", () => {
    const inicio = readFileSync("src/app/(app)/inicio/page.tsx", "utf8");
    const hero = readFileSync("src/components/module-hero.tsx", "utf8");
    for (const src of [inicio, hero]) {
      expect(src).toContain("<HeroBackground />");
      expect(src).toContain("h-[calc(350px+env(safe-area-inset-top))]");
      expect(src).not.toMatch(/<path d="M0 0H390/);
    }
  });
  it("a setinha redonda saiu dos cabeçalhos; o saldo das contas aparece direto no card azul do Resumo", () => {
    expect(readFileSync("src/components/module-hero.tsx", "utf8")).not.toContain("HeroDrawerButton");
    const fin = readFileSync("src/app/(app)/financas/page.tsx", "utf8");
    expect(fin).toContain("<ResumoSaldo");
    expect(fin).not.toContain("HeroDrawerButton");
    const drawer = readFileSync("src/components/hero-drawer.tsx", "utf8");
    expect(drawer).not.toContain("glass-orb absolute");
    expect(drawer).toContain("aria-expanded={ctx.open}");
    // Botão renderizado no servidor: não depende de o painel já ter montado (hasPanel)
    const btn = drawer.slice(drawer.indexOf("export function HeroDrawerButton"), drawer.indexOf("export function HeroDrawer("));
    expect(btn).not.toContain("hasPanel");
  });
});

describe("Início: resumo do item centralizado no arco", () => {
  it("cada item do arco tem o seu resumo, na mesma ordem (e o índice dá a volta, como o arco)", () => {
    expect(HOME_PANELS).toEqual(["financas", "saude", "agenda", "casa", "ministerio"]);
    expect(HOME_MODULES.map((m) => m.href)).toEqual(["/financas", "/saude", "/agenda", "/casa", "/ministerio"]);
    expect([0, 1, 2, 3, 4].map(homePanelAt)).toEqual(["financas", "saude", "agenda", "casa", "ministerio"]);
    expect(homePanelAt(-1)).toBe("ministerio");
    expect(homePanelAt(5)).toBe("financas");
    for (const k of HOME_PANELS) expect(HOME_PANEL_INFO[k].title.length).toBeGreaterThan(3);
  });
  it("começa na Agenda; com ?mes= (seletor de mês das Finanças) começa nas Finanças", () => {
    expect(homePanelAt(initialHomeIndex(false))).toBe("agenda");
    expect(homePanelAt(initialHomeIndex(true))).toBe("financas");
  });
  it("Saúde: próximas consultas/retornos e exames futuros, mais cedo primeiro, até 3, com pessoa", () => {
    const now = Date.parse("2026-11-14T12:00:00-03:00");
    const appt = (id: string, iso: string, kind: "consulta" | "retorno", status = "agendada"): HealthAppointment =>
      ({ id, member_id: "m1", kind, specialty: "Cardiologia", doctor: null, place: null, starts_at: iso, status, notes: null, return_of: null, agenda_event_id: null }) as HealthAppointment;
    const items = nextHealthItems(
      [
        appt("a1", "2026-11-20T09:30:00-03:00", "consulta"),
        appt("a2", "2026-11-14T08:00:00-03:00", "consulta"), // já passou hoje
        appt("a3", "2026-11-16T15:00:00-03:00", "retorno"),
        appt("a4", "2026-11-15T10:00:00-03:00", "consulta", "cancelada"),
      ],
      [
        { id: "e1", member_id: "m2", name: "Hemograma", exam_date: "2026-11-16" },
        { id: "e2", member_id: "m2", name: "Antigo", exam_date: "2026-11-01" },
      ],
      (id) => (id === "m1" ? "Gabriel" : "Karen"),
      "2026-11-14",
      now,
    );
    expect(items).toEqual([
      { id: "a3", when: "16/11/2026 às 15:00", title: "Retorno: Cardiologia", person: "Gabriel" },
      { id: "e1", when: "16/11/2026", title: "Exame: Hemograma", person: "Karen" },
      { id: "a1", when: "20/11/2026 às 09:30", title: "Consulta: Cardiologia", person: "Gabriel" },
    ]);
  });
  it("Agenda: próximos eventos que ainda não terminaram, até 3, com 'Hoje' e dia todo", () => {
    const now = Date.parse("2026-11-14T12:00:00-03:00");
    const ev = (id: string, start: string, end: string, allDay = false) =>
      ({ id, title: `E ${id}`, allDay, startsAt: start, endsAt: end, owner: "Você" }) as AgendaEvent;
    const list = nextAgendaEvents(
      [
        ev("2", "2026-11-15T03:00:00.000Z", "2026-11-16T03:00:00.000Z", true),
        ev("1", "2026-11-14T10:00:00-03:00", "2026-11-14T11:00:00-03:00"), // já terminou
        ev("3", "2026-11-14T19:00:00-03:00", "2026-11-14T20:00:00-03:00"),
        ev("4", "2026-11-17T08:00:00-03:00", "2026-11-17T09:00:00-03:00"),
        ev("5", "2026-11-18T08:00:00-03:00", "2026-11-18T09:00:00-03:00"),
      ],
      "2026-11-14",
      now,
    );
    expect(list).toEqual([
      { id: "3", when: "Hoje às 19:00", title: "E 3", owner: "Você" },
      { id: "2", when: "15/11/2026 · dia todo", title: "E 2", owner: "Você" },
      { id: "4", when: "17/11/2026 às 08:00", title: "E 4", owner: "Você" },
    ]);
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
