/** Grade de um mês para o calendário (semanas de domingo a sábado). Sem fuso: só aritmética de datas. */

export type YearMonth = { year: number; month: number }; // month: 1-12

/** "AAAA-MM-DD" → { year, month } */
export function yearMonthOf(isoDate: string): YearMonth {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y, month: m };
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Semanas do mês; dias fora do mês ficam como null. Cada dia é "AAAA-MM-DD". */
export function monthGrid({ year, month }: YearMonth): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = domingo
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  const mm = String(month).padStart(2, "0");
  for (let d = 1; d <= days; d++) cells.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "Novembro de 2026" */
export function monthLabel({ year, month }: YearMonth): string {
  const s = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "domingo, 8 de novembro de 2026" (para leitores de tela) */
export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export const WEEKDAYS = [
  { short: "D", long: "domingo" },
  { short: "S", long: "segunda-feira" },
  { short: "T", long: "terça-feira" },
  { short: "Q", long: "quarta-feira" },
  { short: "Q", long: "quinta-feira" },
  { short: "S", long: "sexta-feira" },
  { short: "S", long: "sábado" },
];
