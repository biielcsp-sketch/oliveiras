/**
 * Links de contato dos prestadores (funções puras). Só os DÍGITOS do telefone entram na URL:
 * nenhum texto livre digitado pelo usuário chega ao href.
 */
const digitsOf = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "");

/** tel:+5511987654321 (com "+" se o número começa com +) ou null se não houver de 8 a 15 dígitos. */
export function telHref(phone: string | null | undefined): string | null {
  const d = digitsOf(phone);
  if (d.length < 8 || d.length > 15) return null;
  return `tel:${(phone ?? "").trim().startsWith("+") ? "+" : ""}${d}`;
}

/**
 * https://wa.me/<dígitos>. Número brasileiro sem DDI (10 ou 11 dígitos: DDD + número) ganha o 55.
 * Com 12 a 15 dígitos, usa como está (já tem DDI). Outros tamanhos: null (sem botão).
 */
export function whatsappHref(phone: string | null | undefined): string | null {
  const d = digitsOf(phone);
  if (d.length === 10 || d.length === 11) return `https://wa.me/55${d}`;
  if (d.length >= 12 && d.length <= 15) return `https://wa.me/${d}`;
  return null;
}

export type ProviderContact = { name: string; service: string | null; phone: string | null; tel: string | null; whatsapp: string | null };

export function providerContact(p: { name: string; service: string | null; phone: string | null }): ProviderContact {
  return { name: p.name, service: p.service, phone: p.phone, tel: telHref(p.phone), whatsapp: whatsappHref(p.phone) };
}

export const NO_SERVICE = "Outros";

/** Prestadores agrupados por serviço (ordem alfabética; sem serviço por último). */
export function groupProviders<T extends { name: string; service: string | null }>(list: T[]) {
  const map = new Map<string, T[]>();
  for (const p of list) {
    const key = p.service?.trim() || NO_SERVICE;
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === NO_SERVICE ? 1 : b === NO_SERVICE ? -1 : a.localeCompare(b, "pt-BR")))
    .map(([service, items]) => ({ service, items: [...items].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }));
}
