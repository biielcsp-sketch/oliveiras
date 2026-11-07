/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function todaySP(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}
