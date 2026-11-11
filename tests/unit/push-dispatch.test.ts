import { describe, expect, it } from "vitest";
import {
  computeDueNotices,
  isAllowedPushEndpoint,
  type MedicationRow,
  type PetHealthRow,
  type VaccineRow,
} from "../../supabase/functions/push-dispatch/due";

// São Paulo = UTC-3 (sem horário de verão). 08:00 em SP = 11:00 UTC.
const sp = (date: string, time: string, sec = 0) =>
  new Date(`${date}T${time}:${String(sec).padStart(2, "0")}-03:00`);

const med = (over: Partial<MedicationRow> = {}): MedicationRow => ({
  id: "m1",
  household_id: "h1",
  name: "Losartana",
  dosage: "50 mg",
  active: true,
  started_on: null,
  ended_on: null,
  reminder_times: ["08:00"],
  member_name: "Karen",
  ...over,
});

const vac = (over: Partial<VaccineRow> = {}): VaccineRow => ({
  id: "v1",
  household_id: "h1",
  name: "Gripe",
  dose_label: "Reforço",
  next_dose_on: "2026-11-10",
  member_name: "Gabriel",
  ...over,
});

describe("medicamento", () => {
  it("avisa no horário exato, com texto e chave estáveis", () => {
    const [n] = computeDueNotices(sp("2026-11-10", "08:00"), [med()], []);
    expect(n).toMatchObject({
      key: "med:m1:2026-11-10:08:00",
      kind: "medicamento",
      householdId: "h1",
      body: "Hora do remédio: Losartana (50 mg) — Karen",
      url: "/saude/medicamentos",
    });
    expect(n.tag).toBeTruthy();
  });

  it("avisa dentro da janela de 5 min (atraso de até 4 min) e não fora dela", () => {
    expect(computeDueNotices(sp("2026-11-10", "08:04", 59), [med()], [])).toHaveLength(1);
    expect(computeDueNotices(sp("2026-11-10", "08:05"), [med()], [])).toHaveLength(0);
    expect(computeDueNotices(sp("2026-11-10", "07:59", 59), [med()], [])).toHaveLength(0);
  });

  it("mesma chave em execuções diferentes da janela (idempotência)", () => {
    const a = computeDueNotices(sp("2026-11-10", "08:00"), [med()], []);
    const b = computeDueNotices(sp("2026-11-10", "08:03"), [med()], []);
    expect(a[0].key).toBe(b[0].key);
  });

  it("vários horários: só os que caem na janela", () => {
    const m = med({ reminder_times: ["08:00", "14:00", "20:00"] });
    const keys = computeDueNotices(sp("2026-11-10", "14:02"), [m], []).map((n) => n.key);
    expect(keys).toEqual(["med:m1:2026-11-10:14:00"]);
  });

  it("dois horários dentro da mesma janela geram dois avisos", () => {
    const m = med({ reminder_times: ["08:00", "08:02"] });
    expect(computeDueNotices(sp("2026-11-10", "08:03"), [m], [])).toHaveLength(2);
  });

  it("ignora inativo, sem horários e horários inválidos", () => {
    const now = sp("2026-11-10", "08:00");
    expect(computeDueNotices(now, [med({ active: false })], [])).toHaveLength(0);
    expect(computeDueNotices(now, [med({ reminder_times: [] })], [])).toHaveLength(0);
    expect(computeDueNotices(now, [med({ reminder_times: null })], [])).toHaveLength(0);
    expect(computeDueNotices(now, [med({ reminder_times: ["8h", "25:00"] })], [])).toHaveLength(0);
  });

  it("respeita started_on e ended_on (inclusivos)", () => {
    const now = sp("2026-11-10", "08:00");
    expect(computeDueNotices(now, [med({ started_on: "2026-11-10" })], [])).toHaveLength(1);
    expect(computeDueNotices(now, [med({ started_on: "2026-11-11" })], [])).toHaveLength(0);
    expect(computeDueNotices(now, [med({ ended_on: "2026-11-10" })], [])).toHaveLength(1);
    expect(computeDueNotices(now, [med({ ended_on: "2026-11-09" })], [])).toHaveLength(0);
  });

  it("omite dosagem e pessoa ausentes", () => {
    const [n] = computeDueNotices(
      sp("2026-11-10", "08:00"),
      [med({ dosage: null, member_name: null })],
      [],
    );
    expect(n.body).toBe("Hora do remédio: Losartana");
  });

  it("usa o fuso de São Paulo, não o UTC", () => {
    // 08:00 em SP = 11:00 UTC: em UTC o horário 08:00 não bate
    const at = new Date("2026-11-10T11:00:00Z");
    expect(computeDueNotices(at, [med()], [])).toHaveLength(1);
    expect(computeDueNotices(new Date("2026-11-10T08:00:00Z"), [med()], [])).toHaveLength(0);
  });

  it("virada de dia: 00:00–00:03 usa a data de São Paulo, não a do UTC", () => {
    const m = med({ reminder_times: ["00:00"] });
    // 00:02 em SP de 11/11 = 03:02 UTC de 11/11
    const [n] = computeDueNotices(sp("2026-11-11", "00:02"), [m], []);
    expect(n.key).toBe("med:m1:2026-11-11:00:00");
    // 21:00 SP de 10/11 = 00:00 UTC de 11/11: em UTC seria meia-noite, em SP não
    expect(computeDueNotices(new Date("2026-11-11T00:00:00Z"), [m], [])).toHaveLength(0);
  });

  it("janela cruza a meia-noite: 23:58 de ontem ainda é devido às 00:02, com a data de ontem", () => {
    const m = med({ reminder_times: ["23:58"] });
    const [n] = computeDueNotices(sp("2026-11-11", "00:02"), [m], []);
    expect(n.key).toBe("med:m1:2026-11-10:23:58");
    // e a vigência é avaliada na data do horário agendado
    expect(computeDueNotices(sp("2026-11-11", "00:02"), [med({ reminder_times: ["23:58"], ended_on: "2026-11-10" })], [])).toHaveLength(1);
    expect(computeDueNotices(sp("2026-11-11", "00:02"), [med({ reminder_times: ["23:58"], started_on: "2026-11-11" })], [])).toHaveLength(0);
    // 23:55 já saiu da janela às 00:00
    expect(computeDueNotices(sp("2026-11-11", "00:00"), [med({ reminder_times: ["23:55"] })], [])).toHaveLength(0);
  });

  it("não vaza notas nem outros campos no texto", () => {
    const row = { ...med(), notes: "SEGREDO-CLINICO" } as MedicationRow;
    const [n] = computeDueNotices(sp("2026-11-10", "08:00"), [row], []);
    expect(JSON.stringify(n)).not.toContain("SEGREDO-CLINICO");
  });
});

describe("vacina", () => {
  it("avisa 'hoje' às 09:00", () => {
    const [n] = computeDueNotices(sp("2026-11-10", "09:00"), [], [vac()]);
    expect(n).toMatchObject({
      key: "vac:v1:2026-11-10:hoje",
      kind: "vacina",
      householdId: "h1",
      body: "Vacina Gripe - Reforço de Gabriel: hoje",
      url: "/saude/vacinas",
    });
  });

  it("avisa 'amanhã' às 09:00, com chave distinta", () => {
    const [n] = computeDueNotices(sp("2026-11-09", "09:00"), [], [vac()]);
    expect(n.key).toBe("vac:v1:2026-11-09:amanha");
    expect(n.body).toBe("Vacina Gripe - Reforço de Gabriel: amanhã");
  });

  it("não avisa para outro dia", () => {
    expect(computeDueNotices(sp("2026-11-08", "09:00"), [], [vac()])).toHaveLength(0);
    expect(computeDueNotices(sp("2026-11-11", "09:00"), [], [vac()])).toHaveLength(0);
    expect(computeDueNotices(sp("2026-11-10", "09:00"), [], [vac({ next_dose_on: null })])).toHaveLength(0);
  });

  it("respeita a janela de 5 min em torno das 09:00", () => {
    expect(computeDueNotices(sp("2026-11-10", "09:04"), [], [vac()])).toHaveLength(1);
    expect(computeDueNotices(sp("2026-11-10", "09:05"), [], [vac()])).toHaveLength(0);
    expect(computeDueNotices(sp("2026-11-10", "08:59"), [], [vac()])).toHaveLength(0);
  });

  it("'amanhã' vira o mês e o ano corretamente", () => {
    const [n] = computeDueNotices(sp("2026-12-31", "09:00"), [], [vac({ next_dose_on: "2027-01-01" })]);
    expect(n.key).toBe("vac:v1:2026-12-31:amanha");
  });

  it("usa o fuso de São Paulo: 09:00 SP = 12:00 UTC", () => {
    expect(computeDueNotices(new Date("2026-11-10T12:00:00Z"), [], [vac()])).toHaveLength(1);
    expect(computeDueNotices(new Date("2026-11-10T09:00:00Z"), [], [vac()])).toHaveLength(0);
  });

  it("omite dose e pessoa ausentes", () => {
    const [n] = computeDueNotices(sp("2026-11-10", "09:00"), [], [vac({ dose_label: null, member_name: null })]);
    expect(n.body).toBe("Vacina Gripe: hoje");
  });
});

const petItem = (over: Partial<PetHealthRow> = {}): PetHealthRow => ({
  id: "p1",
  household_id: "h1",
  pet_id: "pet1",
  kind: "vacina",
  name: "V10",
  dose: "Reforço",
  applied_on: "2025-11-10",
  next_due_on: "2026-11-10",
  created_at: "2025-11-10T12:00:00Z",
  pet_name: "Moisés",
  ...over,
});

describe("pet (próxima dose da aba Pet)", () => {
  it("avisa 'hoje' às 09:00 de São Paulo, com chave, título, texto e url estáveis", () => {
    const [n] = computeDueNotices(sp("2026-11-10", "09:00"), [], [], [petItem()]);
    expect(n).toEqual({
      key: "pet:p1:2026-11-10:hoje",
      kind: "pet",
      householdId: "h1",
      title: "Pet",
      body: "Moisés: vacina V10 - Reforço: hoje",
      url: "/casa/pet",
      tag: "pet:p1:hoje",
    });
  });

  it("avisa 'amanhã' na véspera, com chave distinta, e não em outros dias", () => {
    const [n] = computeDueNotices(sp("2026-11-09", "09:00"), [], [], [petItem()]);
    expect(n.key).toBe("pet:p1:2026-11-09:amanha");
    expect(n.body).toBe("Moisés: vacina V10 - Reforço: amanhã");
    expect(computeDueNotices(sp("2026-11-08", "09:00"), [], [], [petItem()])).toHaveLength(0);
    expect(computeDueNotices(sp("2026-11-11", "09:00"), [], [], [petItem()])).toHaveLength(0);
    expect(computeDueNotices(sp("2026-11-10", "09:00"), [], [], [petItem({ next_due_on: null })])).toHaveLength(0);
  });

  it("janela de 5 min em torno das 09:00, mesma chave em execuções diferentes (idempotência)", () => {
    const a = computeDueNotices(sp("2026-11-10", "09:00"), [], [], [petItem()]);
    const b = computeDueNotices(sp("2026-11-10", "09:04", 59), [], [], [petItem()]);
    expect(a[0].key).toBe(b[0].key);
    expect(computeDueNotices(sp("2026-11-10", "09:05"), [], [], [petItem()])).toHaveLength(0);
    expect(computeDueNotices(sp("2026-11-10", "08:59"), [], [], [petItem()])).toHaveLength(0);
  });

  it("usa o fuso de São Paulo: 09:00 SP = 12:00 UTC; 'amanhã' vira o ano", () => {
    expect(computeDueNotices(new Date("2026-11-10T12:00:00Z"), [], [], [petItem()])).toHaveLength(1);
    expect(computeDueNotices(new Date("2026-11-10T09:00:00Z"), [], [], [petItem()])).toHaveLength(0);
    const [n] = computeDueNotices(sp("2026-12-31", "09:00"), [], [], [petItem({ next_due_on: "2027-01-01" })]);
    expect(n.key).toBe("pet:p1:2026-12-31:amanha");
  });

  it("rótulo de cada tipo; sem dose omite; sem nome do pet usa 'Pet'; tipo desconhecido é ignorado", () => {
    const at = sp("2026-11-10", "09:00");
    const body = (over: Partial<PetHealthRow>) => computeDueNotices(at, [], [], [petItem(over)])[0]?.body;
    expect(body({ kind: "vermifugo", name: "Drontal", dose: null })).toBe("Moisés: vermífugo Drontal: hoje");
    expect(body({ kind: "antipulgas", name: "Bravecto", dose: "1 comprimido" })).toBe("Moisés: antipulgas Bravecto - 1 comprimido: hoje");
    expect(body({ kind: "remedio", name: "Apoquel" })).toBe("Moisés: remédio Apoquel - Reforço: hoje");
    expect(body({ pet_name: null })).toBe("Pet: vacina V10 - Reforço: hoje");
    expect(computeDueNotices(at, [], [], [petItem({ kind: "constructor" }), petItem({ kind: "outro" })])).toHaveLength(0);
  });

  it("só o registro mais recente de cada (pet, tipo, nome sem acento/maiúscula) avisa", () => {
    const at = sp("2026-11-10", "09:00");
    const old = petItem({ id: "old", name: "Antirrábica" });
    // Dose nova já aplicada (próxima daqui a 1 ano): a antiga não avisa mais.
    const fresh = petItem({ id: "new", name: " ANTIRRABICA ", applied_on: "2026-11-08", next_due_on: "2027-11-08", created_at: "2026-11-08T12:00:00Z" });
    expect(computeDueNotices(at, [], [], [old, fresh])).toHaveLength(0);
    // Dose nova sem próxima data também silencia a antiga.
    expect(computeDueNotices(at, [], [], [old, { ...fresh, next_due_on: null }])).toHaveLength(0);
    // Sem data de aplicação vai para o fim: a antiga com aplicação continua valendo.
    expect(computeDueNotices(at, [], [], [old, { ...fresh, applied_on: null }]).map((n) => n.key)).toEqual(["pet:old:2026-11-10:hoje"]);
    // Mesma aplicação: vale a criada por último.
    const twin = petItem({ id: "twin", created_at: "2025-11-11T12:00:00Z", next_due_on: "2026-11-11" });
    expect(computeDueNotices(at, [], [], [petItem(), twin]).map((n) => n.key)).toEqual(["pet:twin:2026-11-10:amanha"]);
    // Outro pet, outro tipo ou outro nome são grupos diferentes.
    const others = [petItem({ id: "x", pet_id: "pet2" }), petItem({ id: "y", kind: "remedio" }), petItem({ id: "z", name: "V8" })];
    expect(computeDueNotices(at, [], [], [petItem(), ...others])).toHaveLength(4);
  });

  it("não mexe nos avisos da Saúde e não vaza notas", () => {
    const row = { ...petItem(), notes: "SEGREDO-PET" } as PetHealthRow;
    const all = computeDueNotices(sp("2026-11-10", "09:00"), [], [vac()], [row]);
    expect(all.map((n) => n.kind)).toEqual(["vacina", "pet"]);
    expect(JSON.stringify(all)).not.toContain("SEGREDO-PET");
    // Sem o 4º argumento continua igual ao de antes.
    expect(computeDueNotices(sp("2026-11-10", "09:00"), [], [vac()])).toHaveLength(1);
  });
});

describe("isAllowedPushEndpoint (anti-SSRF)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://android.googleapis.com/gcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://push.services.mozilla.com/x",
    "https://web.push.apple.com/abc",
    "https://x.push.apple.com/abc",
    "https://notify.windows.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://FCM.GoogleAPIs.com/fcm/send/abc",
  ])("aceita %s", (u) => expect(isAllowedPushEndpoint(u)).toBe(true));

  it.each([
    "https://evilgoogleapis.com/x",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evil.fcm.googleapis.com/x",
    "https://other.googleapis.com/x",
    "https://evilnotify.windows.com/x",
    "https://evilpush.apple.com/x",
    "https://notify.windows.com.evil.com/x",
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com@evil.com/x",
    "https://evil.com/?h=fcm.googleapis.com",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://[::1]/x",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejeita %s", (u) => expect(isAllowedPushEndpoint(u)).toBe(false));
});
