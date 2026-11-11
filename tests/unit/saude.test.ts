import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkUpload, detectFileKind, fixedFileName, isStoragePath, MAX_FILE_BYTES, storagePath } from "@/lib/saude/files";
import {
  endDateFor,
  LIMITS,
  validateAppointmentInput,
  validateCardInput,
  validateExamInput,
  validateMedicationInput,
  validateProcedureInput,
  validateVaccineInput,
} from "@/lib/saude/input";
import { filterByMember, isOverdue, sortProcedures, sortVaccines, splitAppointments, splitMedications, toInputLocal } from "@/lib/saude/view";
import { appointmentEventInput } from "@/lib/saude/agenda-link";
import {
  CARDS_CACHE,
  clearOfflineCards,
  fileUrl,
  guardOwner,
  META_URL,
  planSync,
  readMeta,
  removeOfflineCard,
  syncOfflineCards,
  type CacheLike,
  type OfflineCard,
  type StorageLike,
} from "@/lib/saude/offline-cards";
import type { HealthAppointment } from "@/lib/saude/types";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const IDS = [M1, M2];

describe("arquivos: bytes mágicos", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  it("reconhece PDF e JPG só pelos bytes", () => {
    expect(detectFileKind(pdf)).toEqual({ mime: "application/pdf", ext: "pdf" });
    expect(detectFileKind(jpg)).toEqual({ mime: "image/jpeg", ext: "jpg" });
  });
  it("rejeita outros formatos, mesmo com cara de PDF no começo incompleto", () => {
    expect(detectFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    expect(detectFileKind(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectFileKind(new TextEncoder().encode("%PDF"))).toBeNull(); // sem o hífen
    expect(detectFileKind(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectFileKind(new Uint8Array())).toBeNull();
  });
  it("limita o tamanho a 5 MB e recusa vazio", () => {
    expect(checkUpload(pdf).ok).toBe(true);
    expect(checkUpload(new Uint8Array())).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(pdf);
    expect(checkUpload(big)).toMatchObject({ ok: false, erro: "O arquivo passa de 5 MB." });
    const edge = new Uint8Array(MAX_FILE_BYTES);
    edge.set(jpg);
    expect(checkUpload(edge).ok).toBe(true);
  });
  it("caminho no bucket segue o padrão do servidor e o nome enviado nunca entra", () => {
    const h = "33333333-3333-4333-8333-333333333333";
    const id = "44444444-4444-4444-8444-444444444444";
    const p = storagePath(h, "cards", id, "pdf");
    expect(p).toBe(`${h}/cards/${id}.pdf`);
    expect(isStoragePath(p)).toBe(true);
    expect(isStoragePath(`${h}/cards/../../x.pdf`)).toBe(false);
    expect(isStoragePath(`${h}/outro/${id}.pdf`)).toBe(false);
    expect(isStoragePath(`${h}/exams/${id}.png`)).toBe(false);
    expect(isStoragePath(null)).toBe(false);
    for (const dir of ["procedures", "vaccines"] as const) {
      const q = storagePath(h, dir, id, "jpg");
      expect(q).toBe(`${h}/${dir}/${id}.jpg`);
      expect(isStoragePath(q)).toBe(true);
    }
    expect(isStoragePath(`${h}/medications/${id}.pdf`)).toBe(false);
    expect(fixedFileName("application/pdf")).toBe("arquivo.pdf");
  });
});

describe("carteirinha", () => {
  it("valida e normaliza", () => {
    const r = validateCardInput({ member_id: M1, operator: "  Unimed  ", card_number: " 123 456 ", plan_name: "", valid_until: "2027-03-31", notes: "" }, IDS);
    expect(r).toEqual({ ok: true, value: { member_id: M1, operator: "Unimed", card_number: "123 456", plan_name: null, valid_until: "2027-03-31", notes: null } });
  });
  it("recusa pessoa fora da família, operadora vazia, validade e textos longos", () => {
    expect(validateCardInput({ member_id: "99999999-9999-4999-8999-999999999999", operator: "X" }, IDS)).toMatchObject({ ok: false });
    expect(validateCardInput({ member_id: M1, operator: " " }, IDS)).toMatchObject({ ok: false, erro: "Informe a operadora." });
    expect(validateCardInput({ member_id: M1, operator: "X", valid_until: "2027-02-31" }, IDS)).toMatchObject({ ok: false, erro: "Validade inválida." });
    expect(validateCardInput({ member_id: M1, operator: "x".repeat(LIMITS.operator + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateCardInput({ member_id: M1, operator: "X", notes: "n".repeat(LIMITS.cardNotes + 1) }, IDS)).toMatchObject({ ok: false });
  });
  it("household_id do formulário é ignorado", () => {
    const r = validateCardInput({ member_id: M1, operator: "X", household_id: "hack" }, IDS);
    expect(r.ok && "household_id" in r.value).toBe(false);
  });
});

describe("consulta e retorno", () => {
  const base = { member_id: M1, kind: "consulta", specialty: "Cardiologia", doctor: "Dra. Ana", place: "Clínica", starts_at: "2027-01-10T14:30", notes: "" };
  it("converte o horário de São Paulo para UTC", () => {
    const r = validateAppointmentInput(base, IDS);
    expect(r.ok && r.value.starts_at).toBe("2027-01-10T17:30:00.000Z");
    expect(r.ok && r.value.status).toBe("agendada");
    expect(r.ok && r.value.return_of).toBeNull();
  });
  it("retorno guarda a consulta de origem; consulta ignora return_of", () => {
    const origin = "55555555-5555-4555-8555-555555555555";
    const ret = validateAppointmentInput({ ...base, kind: "retorno", return_of: origin }, IDS);
    expect(ret.ok && ret.value.return_of).toBe(origin);
    const c = validateAppointmentInput({ ...base, return_of: origin }, IDS);
    expect(c.ok && c.value.return_of).toBeNull();
    expect(validateAppointmentInput({ ...base, kind: "retorno", return_of: "abc" }, IDS)).toMatchObject({ ok: false });
  });
  it("recusa tipo, situação, data e pessoa inválidos", () => {
    expect(validateAppointmentInput({ ...base, kind: "x" }, IDS)).toMatchObject({ ok: false });
    expect(validateAppointmentInput({ ...base, status: "x" }, IDS)).toMatchObject({ ok: false });
    expect(validateAppointmentInput({ ...base, starts_at: "" }, IDS)).toMatchObject({ ok: false });
    expect(validateAppointmentInput({ ...base, member_id: "x" }, IDS)).toMatchObject({ ok: false });
  });
  it("separa próximas e passadas", () => {
    const mk = (id: string, starts_at: string, status: HealthAppointment["status"]): HealthAppointment => ({
      id, member_id: M1, kind: "consulta", specialty: null, doctor: null, place: null, starts_at, status, notes: null, return_of: null, agenda_event_id: null,
    });
    const now = Date.parse("2027-01-10T12:00:00Z");
    const { upcoming, past } = splitAppointments(
      [mk("b", "2027-02-01T10:00:00Z", "agendada"), mk("a", "2027-01-11T10:00:00Z", "agendada"), mk("c", "2027-03-01T10:00:00Z", "cancelada"), mk("d", "2026-12-01T10:00:00Z", "realizada"), mk("e", "2026-12-20T10:00:00Z", "agendada")],
      now,
    );
    expect(upcoming.map((x) => x.id)).toEqual(["a", "b"]);
    expect(past.map((x) => x.id)).toEqual(["c", "e", "d"]);
    expect(toInputLocal("2027-01-10T17:30:00.000Z")).toBe("2027-01-10T14:30");
  });
  it("evento da Agenda: título, 1 hora e local", () => {
    const ev = appointmentEventInput({ kind: "consulta", specialty: "Cardiologia", doctor: "Dra. Ana", place: "Clínica", notes: null, starts_at: "2027-01-10T17:30:00.000Z", memberName: "Karen" });
    expect(ev).toMatchObject({ title: "Consulta — Cardiologia (Karen)", allDay: false, start: "2027-01-10T14:30", end: "2027-01-10T15:30", location: "Clínica", description: "Médico: Dra. Ana" });
    expect(appointmentEventInput({ kind: "retorno", specialty: null, doctor: null, place: null, notes: null, starts_at: "2027-01-10T17:30:00.000Z", memberName: "Leo" })?.title).toBe("Retorno (Leo)");
    expect(ev?.reminders).toEqual([1440, 60]);
    expect(appointmentEventInput({ kind: "retorno", specialty: null, doctor: null, place: null, notes: null, starts_at: "2027-01-10T17:30:00.000Z", memberName: "Leo" })?.reminders).toEqual([1440, 60]);
  });
});

describe("exame", () => {
  it("valida; arquivo e data são opcionais", () => {
    expect(validateExamInput({ member_id: M2, name: " Hemograma ", exam_date: "", result_summary: "Tudo normal" }, IDS)).toEqual({
      ok: true,
      value: { member_id: M2, name: "Hemograma", exam_date: null, lab: null, requested_by: null, result_summary: "Tudo normal" },
    });
    expect(validateExamInput({ member_id: M2, name: "" }, IDS)).toMatchObject({ ok: false });
    expect(validateExamInput({ member_id: M2, name: "X", exam_date: "2027-13-01" }, IDS)).toMatchObject({ ok: false });
    expect(validateExamInput({ member_id: M2, name: "X", result_summary: "r".repeat(LIMITS.summary + 1) }, IDS)).toMatchObject({ ok: false });
  });
});

describe("procedimento", () => {
  it("valida e normaliza; data e demais campos são opcionais", () => {
    expect(validateProcedureInput({ member_id: M1, name: "  Endoscopia  ", performed_on: "", notes: "ok" }, IDS)).toEqual({
      ok: true,
      value: { member_id: M1, name: "Endoscopia", performed_on: null, place: null, doctor: null, notes: "ok" },
    });
  });
  it("recusa nome vazio, pessoa de fora, data inválida e textos acima do limite", () => {
    expect(validateProcedureInput({ member_id: M1, name: " " }, IDS)).toMatchObject({ ok: false });
    expect(validateProcedureInput({ member_id: "99999999-9999-4999-8999-999999999999", name: "X" }, IDS)).toMatchObject({ ok: false });
    expect(validateProcedureInput({ member_id: M1, name: "X", performed_on: "2026-02-30" }, IDS)).toMatchObject({ ok: false });
    expect(validateProcedureInput({ member_id: M1, name: "n".repeat(LIMITS.procName + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateProcedureInput({ member_id: M1, name: "X", notes: "n".repeat(LIMITS.procNotes + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateProcedureInput({ member_id: M1, name: "X", notes: "n".repeat(LIMITS.procNotes) }, IDS).ok).toBe(true);
  });
  it("household_id e file_path do formulário nunca entram no valor", () => {
    const r = validateProcedureInput({ member_id: M1, name: "X", household_id: "evil", file_path: "evil" }, IDS);
    expect(r.ok && Object.keys(r.value)).not.toContain("household_id");
    expect(r.ok && Object.keys(r.value)).not.toContain("file_path");
  });
  it("ordena do mais recente ao mais antigo, sem data por último", () => {
    const l = [{ performed_on: "2020-01-01" }, { performed_on: null }, { performed_on: "2025-05-05" }];
    expect(sortProcedures(l).map((x) => x.performed_on)).toEqual(["2025-05-05", "2020-01-01", null]);
  });
});

describe("medicamento", () => {
  it("sem término = em uso; com término = encerrado", () => {
    expect(validateMedicationInput({ member_id: M1, name: " Dipirona ", dosage: "500 mg", started_on: "2026-01-01" }, IDS)).toEqual({
      ok: true,
      value: { member_id: M1, name: "Dipirona", dosage: "500 mg", frequency: null, started_on: "2026-01-01", ended_on: null, active: true, prescribed_by: null, notes: null, reminder_times: [] },
    });
    const ended = validateMedicationInput({ member_id: M1, name: "X", started_on: "2026-01-01", ended_on: "2026-01-10" }, IDS);
    expect(ended.ok && ended.value).toMatchObject({ ended_on: "2026-01-10", active: false });
  });
  it("ended_on >= started_on (mesmo dia vale)", () => {
    expect(validateMedicationInput({ member_id: M1, name: "X", started_on: "2026-01-10", ended_on: "2026-01-09" }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: M1, name: "X", started_on: "2026-01-10", ended_on: "2026-01-10" }, IDS).ok).toBe(true);
    expect(validateMedicationInput({ member_id: M1, name: "X", ended_on: "2026-01-09" }, IDS).ok).toBe(true);
  });
  it("recusa nome vazio, datas inválidas e limites", () => {
    expect(validateMedicationInput({ member_id: M1, name: "" }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: M1, name: "X", started_on: "x" }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: M1, name: "X", ended_on: "2026-13-01" }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: M1, name: "X", dosage: "d".repeat(LIMITS.dosage + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: M1, name: "X", frequency: "d".repeat(LIMITS.frequency + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: M1, name: "X", prescribed_by: "d".repeat(LIMITS.doctor + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: M1, name: "X", notes: "d".repeat(LIMITS.medNotes + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateMedicationInput({ member_id: "nope", name: "X" }, IDS)).toMatchObject({ ok: false });
  });
  it("encerrar usa hoje, mas nunca antes do início", () => {
    expect(endDateFor("2026-01-01", "2026-11-09")).toBe("2026-11-09");
    expect(endDateFor(null, "2026-11-09")).toBe("2026-11-09");
    expect(endDateFor("2026-12-01", "2026-11-09")).toBe("2026-12-01");
  });
  it("separa em uso e encerrados", () => {
    const r = splitMedications([{ id: 1, active: true }, { id: 2, active: false }, { id: 3, active: true }]);
    expect(r.active.map((x) => x.id)).toEqual([1, 3]);
    expect(r.ended.map((x) => x.id)).toEqual([2]);
  });
});

describe("vacina", () => {
  it("valida e normaliza; só nome e pessoa são obrigatórios", () => {
    expect(validateVaccineInput({ member_id: M2, name: " Hepatite B ", dose_label: "2ª dose", next_dose_on: "2027-01-15" }, IDS)).toEqual({
      ok: true,
      value: { member_id: M2, name: "Hepatite B", dose_label: "2ª dose", applied_on: null, next_dose_on: "2027-01-15", place: null, lot: null, notes: null },
    });
  });
  it("recusa nome vazio, datas inválidas e limites do banco", () => {
    expect(validateVaccineInput({ member_id: M2, name: "" }, IDS)).toMatchObject({ ok: false });
    expect(validateVaccineInput({ member_id: M2, name: "X", applied_on: "ontem" }, IDS)).toMatchObject({ ok: false });
    expect(validateVaccineInput({ member_id: M2, name: "X", next_dose_on: "2027-02-31" }, IDS)).toMatchObject({ ok: false });
    expect(validateVaccineInput({ member_id: M2, name: "X", dose_label: "d".repeat(LIMITS.doseLabel + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateVaccineInput({ member_id: M2, name: "X", lot: "d".repeat(LIMITS.lot + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateVaccineInput({ member_id: M2, name: "X", notes: "d".repeat(LIMITS.vaccineNotes + 1) }, IDS)).toMatchObject({ ok: false });
    expect(validateVaccineInput({ member_id: M2, name: "X", lot: "d".repeat(LIMITS.lot) }, IDS).ok).toBe(true);
    expect(validateVaccineInput({ member_id: "99999999-9999-4999-8999-999999999999", name: "X" }, IDS)).toMatchObject({ ok: false });
  });
  it("ordena pela próxima dose mais cedo; sem data depois, pela aplicação mais recente", () => {
    const l = [
      { n: "a", next_dose_on: null, applied_on: "2020-01-01" },
      { n: "b", next_dose_on: "2027-05-01", applied_on: null },
      { n: "c", next_dose_on: null, applied_on: "2024-01-01" },
      { n: "d", next_dose_on: "2026-12-01", applied_on: null },
    ];
    expect(sortVaccines(l).map((x) => x.n)).toEqual(["d", "b", "c", "a"]);
  });
  it("próxima dose atrasada e filtro por pessoa", () => {
    expect(isOverdue("2026-11-08", "2026-11-09")).toBe(true);
    expect(isOverdue("2026-11-09", "2026-11-09")).toBe(false);
    expect(isOverdue(null, "2026-11-09")).toBe(false);
    const l = [{ member_id: M1 }, { member_id: M2 }];
    expect(filterByMember(l, M2)).toEqual([{ member_id: M2 }]);
    expect(filterByMember(l, "")).toHaveLength(2);
  });
});

/* ---------- Cache offline das carteirinhas (Cache API falsa) ---------- */

function fakeStorage() {
  const caches = new Map<string, Map<string, Response>>();
  const cacheOf = (name: string): CacheLike => {
    const m = caches.get(name) ?? new Map<string, Response>();
    caches.set(name, m);
    return {
      async match(url) {
        return m.get(url)?.clone();
      },
      async put(url, res) {
        m.set(url, res);
      },
      async delete(url) {
        return m.delete(url);
      },
    };
  };
  const storage: StorageLike = {
    open: async (name) => cacheOf(name),
    delete: async (name) => caches.delete(name),
  };
  return { storage, caches };
}

const card = (n: number, over: Partial<OfflineCard> = {}): OfflineCard => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  operator: `Op${n}`,
  person: "Karen",
  number: `99${n}`,
  mime: "application/pdf",
  updatedAt: "2027-01-01T00:00:00Z",
  ...over,
});
const okFetch = (log: string[] = []) => async (url: string) => {
  log.push(url);
  return new Response("%PDF-1", { status: 200, headers: { "content-type": "application/pdf" } });
};

describe("carteirinhas offline", () => {
  it("planSync: apaga se for outro usuário, remove as que saíram, baixa novas e alteradas", () => {
    const meta = { userId: "u1", cards: [card(1), card(2)] };
    expect(planSync(meta, "u2", [card(1)])).toEqual({ wipe: true, remove: [], changed: [card(1).id] });
    expect(planSync(meta, "u1", [card(2, { updatedAt: "novo" }), card(3)])).toEqual({ wipe: false, remove: [card(1).id], changed: [card(2).id, card(3).id] });
    expect(planSync(null, "u1", [card(1)]).changed).toEqual([card(1).id]);
  });

  it("guarda arquivo e só o mínimo de metadados no cache dedicado", async () => {
    const { storage, caches } = fakeStorage();
    const log: string[] = [];
    await syncOfflineCards(storage, okFetch(log), "u1", [card(1), card(2)]);
    expect([...caches.keys()]).toEqual([CARDS_CACHE]);
    expect([...caches.get(CARDS_CACHE)!.keys()].sort()).toEqual([META_URL, fileUrl(card(1).id), fileUrl(card(2).id)].sort());
    const meta = await readMeta(storage);
    expect(meta?.userId).toBe("u1");
    expect(Object.keys(meta!.cards[0]).sort()).toEqual(["id", "mime", "number", "operator", "person", "updatedAt"]);
    // Segunda sincronização sem mudanças não baixa de novo.
    await syncOfflineCards(storage, okFetch(log), "u1", [card(1), card(2)]);
    expect(log).toHaveLength(2);
  });

  it("carteirinha apagada no app sai do cache; alterada é baixada de novo", async () => {
    const { storage, caches } = fakeStorage();
    const log: string[] = [];
    await syncOfflineCards(storage, okFetch(log), "u1", [card(1), card(2)]);
    await syncOfflineCards(storage, okFetch(log), "u1", [card(2, { updatedAt: "novo" })]);
    const keys = [...caches.get(CARDS_CACHE)!.keys()];
    expect(keys).not.toContain(fileUrl(card(1).id));
    expect(log.at(-1)).toBe(fileUrl(card(2).id));
    expect((await readMeta(storage))?.cards.map((c) => c.id)).toEqual([card(2).id]);
    await removeOfflineCard(storage, card(2).id);
    expect((await readMeta(storage))?.cards).toEqual([]);
    expect([...caches.get(CARDS_CACHE)!.keys()]).toEqual([META_URL]);
  });

  it("outro usuário no aparelho: apaga tudo do anterior", async () => {
    const { storage, caches } = fakeStorage();
    await syncOfflineCards(storage, okFetch(), "u1", [card(1)]);
    await guardOwner(storage, "u1");
    expect(caches.has(CARDS_CACHE)).toBe(true);
    await guardOwner(storage, "u2");
    expect(caches.has(CARDS_CACHE)).toBe(false);
    // E sincronizar como outro usuário nunca mistura com o anterior.
    await syncOfflineCards(storage, okFetch(), "u1", [card(1)]);
    await syncOfflineCards(storage, okFetch(), "u2", [card(3)]);
    expect((await readMeta(storage))).toMatchObject({ userId: "u2", cards: [{ id: card(3).id }] });
    expect([...caches.get(CARDS_CACHE)!.keys()]).not.toContain(fileUrl(card(1).id));
  });

  it("sair da conta apaga cache e metadados", async () => {
    const { storage, caches } = fakeStorage();
    await syncOfflineCards(storage, okFetch(), "u1", [card(1)]);
    await clearOfflineCards(storage);
    expect(caches.size).toBe(0);
    expect(await readMeta(storage)).toBeNull();
  });

  it("resposta que não é PDF/JPG ou erro de rede não entra no cache e não apaga o que já existe", async () => {
    const { storage } = fakeStorage();
    await syncOfflineCards(storage, okFetch(), "u1", [card(1)]);
    const html = async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    const down = async () => {
      throw new Error("offline");
    };
    await syncOfflineCards(storage, html, "u1", [card(1, { updatedAt: "novo" }), card(2)]);
    expect((await readMeta(storage))?.cards.map((c) => c.id)).toEqual([card(1).id]);
    await syncOfflineCards(storage, down, "u1", [card(1)]);
    expect((await readMeta(storage))?.cards.map((c) => c.id)).toEqual([card(1).id]);
  });
});

describe("service worker (regras do cache de carteirinhas)", () => {
  const sw = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");
  it("o cache dedicado sobrevive à limpeza de versões antigas e tem o mesmo nome do app", () => {
    expect(sw).toContain(`const CARDS_CACHE = "${CARDS_CACHE}"`);
    expect(sw).toMatch(/k !== CACHE && k !== CARDS_CACHE/);
  });
  it("só intercepta GET da rota de arquivo de carteirinhas e nunca grava respostas por conta própria", () => {
    expect(sw).toContain('if (req.method !== "GET") return;');
    expect(sw).toContain("saude\\/arquivo\\/carteirinhas\\/");
    expect(sw).not.toMatch(/\.put\(|addAll\(\[?\s*req|cache\.add\(/);
  });
  it("js/css da tela offline também saem do cache sem rede (senão a lista não monta)", () => {
    expect(sw).toMatch(/req\.mode !== "navigate" && PRECACHE\.includes\(url\.pathname\)/);
    expect(sw).toContain("caches.match(url.pathname)");
  });
});

describe("página offline de carteirinhas", () => {
  const dir = fileURLToPath(new URL("../../public/", import.meta.url));
  const html = readFileSync(dir + "offline-carteirinhas.html", "utf8");
  it("sem script/estilo inline nem handlers; script externo", () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\son[a-z]+=|style=/i);
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(html).toContain('<script src="/offline-carteirinhas.js"></script>');
  });
  it("o script monta a lista só com textContent", () => {
    const js = readFileSync(dir + "offline-carteirinhas.js", "utf8");
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });
});
