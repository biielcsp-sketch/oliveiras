/**
 * Datas da Agenda no fuso de São Paulo. Funções puras (servidor e navegador).
 * - Dia: "AAAA-MM-DD"; horário local: "AAAA-MM-DDTHH:mm".
 * - O banco guarda timestamptz; eventos de dia inteiro ficam à meia-noite de São Paulo,
 *   com o fim EXCLUSIVO (como o `end.date` do Google).
 */
export const TZ = "America/Sao_Paulo";
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "AAAA-MM-DDTHH:mm" (segundos opcionais) válido → normalizado sem segundos; senão null. */
export function normalizeLocal(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = LOCAL_RE.exec(v.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isDate(date) || +m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59)) return null;
  return `${date}T${m[4]}:${m[5]}`;
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Dias entre duas datas (b − a). */
export function diffDays(a: string, b: string) {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / DAY_MS);
}

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function spParts(ms: number) {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value;
  return p;
}

/** Diferença (minutos) entre o horário de São Paulo e o UTC naquele instante (ex.: −180). */
export function spOffsetMinutes(ms: number) {
  const p = spParts(ms);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** Horário local de São Paulo → instante UTC (ms). Considera o horário de verão, se voltar a existir. */
export function spLocalToMs(local: string) {
  const n = normalizeLocal(local);
  if (!n) throw new Error("horário inválido");
  const [date, time] = n.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mi);
  let ms = naive - spOffsetMinutes(naive) * 60_000;
  ms = naive - spOffsetMinutes(ms) * 60_000; // segunda passada acerta a virada de offset
  return ms;
}

export const spMidnightIso = (date: string) => new Date(spLocalToMs(`${date}T00:00`)).toISOString();

/** "AAAA-MM-DDTHH:mm:ss-03:00": horário local com o offset do instante (formato RFC 3339 do Google). */
export function spLocalToRfc3339(local: string) {
  const ms = spLocalToMs(local);
  const off = spOffsetMinutes(ms);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${normalizeLocal(local)}:00${sign}${hh}:${mm}`;
}

/** Instante → "AAAA-MM-DDTHH:mm" em São Paulo. */
export function toSpLocal(iso: string | number | Date) {
  const p = spParts(new Date(iso).getTime());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export const toSpDate = (iso: string | number | Date) => toSpLocal(iso).slice(0, 10);
export const toSpTime = (iso: string | number | Date) => toSpLocal(iso).slice(11, 16);

/** Domingo da semana do dia (semanas de domingo a sábado, como o calendário). */
export function weekStart(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return addDays(date, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

/** "seg., 9 de nov." */
export function shortDayLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** "segunda-feira, 9 de novembro" */
export function longDayLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const s = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "09/11/2026" */
export const brDate = (date: string) => date.split("-").reverse().join("/");
