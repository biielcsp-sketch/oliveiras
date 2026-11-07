const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Mês atual (AAAA-MM) no fuso de São Paulo. */
export function currentMonth(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  return parts.slice(0, 7);
}

/** Valida "AAAA-MM"; se inválido, devolve o mês atual. */
export function parseMonth(value: string | undefined | null, now?: Date) {
  return value && MONTH_RE.test(value) ? value : currentMonth(now);
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Intervalo [início, fim) em datas ISO para filtrar lançamentos do mês. */
export function monthRange(month: string) {
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "2026-11-07" → "07/11" */
export function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
