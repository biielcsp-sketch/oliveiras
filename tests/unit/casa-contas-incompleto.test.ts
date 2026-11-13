// Casa › Contas usa as sugestões de baixa das Finanças. Com o extrato grande demais (ou falha na leitura)
// as sugestões vêm vazias: a tela precisa explicar isso em vez de só não mostrar sugestão nenhuma.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

let incomplete = false;
vi.mock("@/lib/financas/baixa-data", () => ({
  getAllBaixaSuggestions: async () => ({ fixed: [], oneOff: [], incomplete }),
}));
vi.mock("@/lib/financas/planning-data", () => ({
  getBills: async () => [],
  getBillPayments: async () => [],
  getOneOffBillsForMonth: async () => [],
  getOneOffBoletoDocs: async () => new Map(),
}));
vi.mock("@/lib/financas/documentos/data", () => ({
  countPendingDocuments: async () => 0,
  getConfirmedBillDocs: async () => new Map(),
}));
// Componentes de cliente fora do assunto do teste.
vi.mock("@/app/(app)/financas/_components/month-switcher", () => ({ MonthSwitcher: () => null }));
vi.mock("@/app/(app)/financas/_components/doc-upload", () => ({ DocUpload: () => null }));

const { default: Page } = await import("@/app/(app)/casa/contas/page");

const render = async () => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ mes: "2026-11" }) }));

beforeEach(() => {
  incomplete = false;
});

describe("Casa › Contas: extrato incompleto", () => {
  it("mostra o aviso quando as sugestões vêm incompletas", async () => {
    incomplete = true;
    const html = await render();
    expect(html).toContain('data-testid="lista-incompleta"');
    expect(html).toContain("Sugestões de pagamento indisponíveis: extrato grande demais");
  });

  it("sem aviso quando o extrato veio inteiro", async () => {
    const html = await render();
    expect(html).not.toContain("lista-incompleta");
  });
});
