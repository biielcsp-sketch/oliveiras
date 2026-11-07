/** Converte texto digitado em reais para número (2 casas). Aceita "1.234,56", "-12,5", "12.50", "R$ 10". */
export function parseBRL(input: string): number | null {
  let s = input.trim().replace(/\s|R\$/gi, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  let normalized: string;
  if (s.includes(",")) {
    // vírgula decimal; pontos são milhar
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    normalized = s; // ponto decimal (ex.: 12.50 vindo de CSV)
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, ""); // 1.234 = mil duzentos e trinta e quatro
  } else if (/^\d+$/.test(s)) {
    normalized = s;
  } else {
    return null;
  }
  const value = Math.round(Number(normalized) * 100) / 100;
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(value: number) {
  return brl.format(value);
}

/** Soma em centavos para não acumular erro de ponto flutuante. */
export function sum(values: number[]) {
  return values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}
