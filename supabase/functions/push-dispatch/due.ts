// Lógica pura (sem Deno, sem rede) dos avisos push da Saúde.
// Importada pelo Edge Function (index.ts) e pelo vitest (tests/unit/push-dispatch.test.ts).

export const TIME_ZONE = "America/Sao_Paulo";
/** Janela de tolerância: o horário agendado pode ter caído em now-4min..now. */
export const WINDOW_MINUTES = 5;
export const VACCINE_TIME = "09:00";

export type MedicationRow = {
  id: string;
  household_id: string;
  name: string;
  dosage: string | null;
  active: boolean;
  started_on: string | null;
  ended_on: string | null;
  reminder_times: string[] | null;
  member_name: string | null;
};

export type VaccineRow = {
  id: string;
  household_id: string;
  name: string;
  dose_label: string | null;
  next_dose_on: string | null;
  member_name: string | null;
};

export type DueNotice = {
  key: string;
  kind: "medicamento" | "vacina";
  householdId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
};

type Slot = { date: string; time: string };

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Data (YYYY-MM-DD) e hora (HH:MM) de um instante no fuso de São Paulo. */
export function saoPauloSlot(instant: Date): Slot {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(instant)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Soma dias a uma string YYYY-MM-DD (aritmética de calendário, sem fuso). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Os minutos (data+hora de SP) cobertos pela janela: now, now-1min, ... now-4min. */
export function windowSlots(now: Date): Slot[] {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const slots: Slot[] = [];
  for (let i = 0; i < WINDOW_MINUTES; i++) {
    slots.push(saoPauloSlot(new Date(minute - i * 60_000)));
  }
  return slots;
}

function normalizeTime(value: string): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

function isoDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export function computeDueNotices(
  now: Date,
  medications: MedicationRow[],
  vaccines: VaccineRow[],
): DueNotice[] {
  const slots = windowSlots(now);
  const notices: DueNotice[] = [];

  for (const med of medications) {
    if (!med.active) continue;
    const times = new Set(
      (med.reminder_times ?? []).map(normalizeTime).filter((t): t is string => t !== null),
    );
    if (times.size === 0) continue;
    const started = isoDay(med.started_on);
    const ended = isoDay(med.ended_on);
    for (const slot of slots) {
      if (!times.has(slot.time)) continue;
      if (started && started > slot.date) continue;
      if (ended && ended < slot.date) continue;
      const dosage = med.dosage?.trim();
      const who = med.member_name?.trim();
      notices.push({
        key: `med:${med.id}:${slot.date}:${slot.time}`,
        kind: "medicamento",
        householdId: med.household_id,
        title: "Hora do remédio",
        body: `Hora do remédio: ${med.name.trim()}${dosage ? ` (${dosage})` : ""}${who ? ` — ${who}` : ""}`,
        url: "/saude/medicamentos",
        tag: `med:${med.id}:${slot.time}`,
      });
    }
  }

  const vaccineSlot = slots.find((s) => s.time === VACCINE_TIME);
  if (vaccineSlot) {
    const today = vaccineSlot.date;
    const tomorrow = addDays(today, 1);
    for (const vac of vaccines) {
      const next = isoDay(vac.next_dose_on);
      if (!next) continue;
      let when: "hoje" | "amanha";
      if (next === today) when = "hoje";
      else if (next === tomorrow) when = "amanha";
      else continue;
      const dose = vac.dose_label?.trim();
      const who = vac.member_name?.trim();
      notices.push({
        key: `vac:${vac.id}:${today}:${when}`,
        kind: "vacina",
        householdId: vac.household_id,
        title: "Vacina",
        body: `Vacina ${vac.name.trim()}${dose ? ` - ${dose}` : ""}${who ? ` de ${who}` : ""}: ${when === "hoje" ? "hoje" : "amanhã"}`,
        url: "/saude/vacinas",
        tag: `vac:${vac.id}:${when}`,
      });
    }
  }

  return notices;
}

// Anti-SSRF: o Edge Function roda com service role e só pode falar com serviços de push conhecidos.
const PUSH_EXACT_HOSTS = ["fcm.googleapis.com", "android.googleapis.com"];
const PUSH_DOMAIN_SUFFIXES = [
  "push.services.mozilla.com", // updates.push.services.mozilla.com e subdomínios
  "push.apple.com", // web.push.apple.com e subdomínios
  "notify.windows.com", // WNS (Edge)
];

/** https, sem credenciais, sem porta explícita e host na allowlist (igual ao domínio ou subdomínio real). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (PUSH_EXACT_HOSTS.includes(host)) return true;
  return PUSH_DOMAIN_SUFFIXES.some((d) => host === d || host.endsWith(`.${d}`));
}
