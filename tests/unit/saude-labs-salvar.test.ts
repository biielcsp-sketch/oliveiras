import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gravação em "transação lógica": se a coleta ou os resultados falharem, nada fica pela metade
 * (apaga a coleta, que leva os resultados em cascata, e o arquivo do bucket).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ME = "11111111-1111-4111-8111-111111111111";
const HH = "eeeeeeee-0000-4000-8000-0000000000aa";
const calls: string[] = [];
let failReport = false;
let failResults = false;
let failUpload = false;
let existing: { lab: string | null }[] = [];

vi.mock("@/lib/data", () => ({
  getAppContext: async () => ({ household: { id: HH }, members: [{ id: ME, name: "Gabriel" }], me: { id: ME }, user: { id: "u" } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => {
          calls.push(`upload:${path}`);
          return { error: failUpload ? { message: "x" } : null };
        },
        remove: async (paths: string[]) => {
          calls.push(`remove:${paths[0]}`);
          return { error: null };
        },
      }),
    },
    from: (table: string) => ({
      select: () => {
        const q: Record<string, unknown> = {};
        q.eq = () => q;
        q.then = (res: (v: unknown) => void) => res({ data: existing, error: null });
        calls.push(`select:${table}`);
        return q;
      },
      insert: (rows: unknown) => {
        calls.push(`insert:${table}:${Array.isArray(rows) ? rows.length : 1}`);
        const err = table === "health_lab_reports" ? failReport : failResults;
        const out = { error: err ? { message: "x" } : null };
        return Object.assign(Promise.resolve(out), { select: () => ({ single: async () => (err ? { data: null, error: { message: "x" } } : { data: { id: "rep-1" }, error: null }) }) });
      },
      delete: () => ({
        eq: () => ({
          eq: async (_c: string, id: string) => {
            calls.push(`delete:${table}:${id}`);
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));

const { saveLabReport } = await import("@/app/(app)/saude/exames-lab/actions");

const rows = [{ biomarker_key: "tsh", name: "TSH", category: "tireoide", value: "2,1", unit: "mUI/L", ref_min: "0,4", ref_max: "4", ref_text: "" }];
const form = (o: { member?: string; date?: string; rows?: unknown; file?: Blob | null } = {}) => {
  const f = new FormData();
  f.set("member_id", o.member ?? ME);
  f.set("collected_on", o.date ?? "2026-10-01");
  f.set("lab", "Lab");
  f.set("rows", JSON.stringify(o.rows ?? rows));
  if (o.file !== null) f.set("file", o.file ?? new File(["%PDF-1.4\n"], "x.pdf", { type: "application/pdf" }));
  return f;
};

beforeEach(() => {
  calls.length = 0;
  failReport = failResults = failUpload = false;
  existing = [];
});

describe("saveLabReport", () => {
  it("sucesso: sobe o PDF em {família}/exams/{uuid}.pdf, cria a coleta e os resultados com a família do servidor", async () => {
    const r = await saveLabReport(form());
    expect(r).toEqual({ ok: true, member_id: ME });
    expect(calls[0]).toBe("select:health_lab_reports");
    expect(calls[1]).toMatch(new RegExp(`^upload:${HH}/exams/[0-9a-f-]{36}\\.pdf$`));
    expect(calls.slice(2)).toEqual(["insert:health_lab_reports:1", "insert:health_lab_results:1"]);
  });
  it("falha nos resultados: apaga a coleta (cascata) e o arquivo; nada fica pela metade", async () => {
    failResults = true;
    const r = await saveLabReport(form());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar. Tente de novo." });
    expect(calls).toContain("delete:health_lab_reports:rep-1");
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(true);
  });
  it("falha ao criar a coleta: apaga só o arquivo enviado", async () => {
    failReport = true;
    expect(await saveLabReport(form())).toMatchObject({ ok: false });
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(true);
    expect(calls.some((c) => c.startsWith("delete:"))).toBe(false);
    expect(calls).not.toContain("insert:health_lab_results:1");
  });
  it("falha no upload: não cria nada", async () => {
    failUpload = true;
    expect(await saveLabReport(form())).toEqual({ ok: false, erro: "Não foi possível enviar o arquivo. Tente de novo." });
    expect(calls).toEqual(["select:health_lab_reports", expect.stringMatching(/^upload:/)]);
  });
  it("duplicidade (mesma pessoa + data + laboratório, sem caixa/espaços): recusa ANTES do upload", async () => {
    existing = [{ lab: "  LAB  " }];
    expect(await saveLabReport(form())).toEqual({ ok: false, erro: "Já existe uma coleta desta pessoa nesta data neste laboratório. Apague a anterior para reenviar." });
    expect(calls).toEqual(["select:health_lab_reports"]);
  });
  it("outro laboratório na mesma data, ou laboratório vazio contra preenchido, não é duplicidade; vazio contra vazio é", async () => {
    existing = [{ lab: "Outro" }, { lab: null }];
    expect((await saveLabReport(form())).ok).toBe(true);
    calls.length = 0;
    const f = form();
    f.set("lab", "");
    existing = [{ lab: " " }];
    expect(await saveLabReport(f)).toMatchObject({ ok: false });
    expect(calls).toEqual(["select:health_lab_reports"]);
  });
  it("validações antes de qualquer gravação: pessoa de outra família, data, linhas, arquivo falso ou grande", async () => {
    const bad = [
      form({ member: "33333333-3333-4333-8333-333333333333" }),
      form({ member: "nao-uuid" }),
      form({ date: "2999-01-01" }),
      form({ rows: [] }),
      form({ file: null }),
      form({ file: new File(["<html>"], "x.pdf", { type: "application/pdf" }) }),
      form({ file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], "x.pdf", { type: "application/pdf" }) }),
    ];
    for (const f of bad) expect(await saveLabReport(f)).toMatchObject({ ok: false });
    const broken = form();
    broken.set("rows", "{não é json");
    expect(await saveLabReport(broken)).toEqual({ ok: false, erro: "Dados inválidos." });
    expect(calls).toEqual([]);
  });
});
