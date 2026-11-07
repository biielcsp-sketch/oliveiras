/** Idade em anos completos a partir de uma data ISO (AAAA-MM-DD). */
export function ageFrom(birth: string | null, now: Date = new Date()): number | null {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number);
  if (!y || !m || !d) return null;
  let years = now.getFullYear() - y;
  const beforeBirthday = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
  if (beforeBirthday) years--;
  return years < 0 ? null : years;
}

/** Saudação conforme a hora (0–23). */
export function greetingFor(hour: number) {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
