/**
 * Linha digitável / código de barras de boletos (FEBRABAN). Funções puras.
 *
 * Bancário: linha digitável de 47 dígitos ou código de barras de 44.
 *  - Código de barras: banco(3) moeda(1) DV(1) fator(4) valor(10) campo livre(25).
 *  - DV de cada um dos 3 primeiros campos da linha: módulo 10 (pesos 2,1 da direita).
 *  - DV geral (posição 5 do código): módulo 11 (pesos 2..9 da direita); 0, 10 ou 11 → 1.
 * Arrecadação/convênio (água, luz, tributos): 48 dígitos na linha ou 44 no código, começa com 8.
 *  - 3º dígito: 6/7 → DV módulo 10; 8/9 → DV módulo 11 (resto 0 ou 1 → 0; senão 11 − resto).
 *  - 6/8 → valor efetivo em reais nas posições 5–15; 7/9 → valor de referência (não é reais).
 *  - DV geral na posição 4 do código; na linha, cada bloco de 11 dígitos tem o seu DV.
 *
 * Fator de vencimento (bancário): dias desde a data-base 07/10/1997. O fator chegou a 9999 em
 * 21/02/2025 e a contagem foi reiniciada: 22/02/2025 = fator 1000, +1 por dia até 9999 de novo
 * (ciclos de 9000 dias). Como o mesmo fator vale para mais de uma data, usamos a mais próxima
 * da data de referência (dia do envio).
 * Fontes conferidas em 10/11/2026: comentário e implementação de brcobranca
 * (github.com/kivanio/brcobranca, lib/brcobranca/calculo_data.rb: "A partir de 22.02.2025, o fator
 * retorna para '1000'") e boleto-utils (github.com/mrmgomes/boleto-utils, src/boleto-utils.js:
 * data-base 2025-02-22 para o fator 1000), que seguem a regra divulgada pela FEBRABAN.
 */

export type BoletoTipo = "bancario" | "arrecadacao";

export type BoletoInfo = {
  tipo: BoletoTipo;
  /** Código de barras (44 dígitos), derivado da linha quando preciso. */
  barras: string;
  /** Valor em reais lido do código; null se o código não traz valor (zero ou valor de referência). */
  valor: number | null;
  /** Vencimento AAAA-MM-DD (só bancário; null quando o fator é 0000). */
  vencimento: string | null;
};

export type BoletoResult = { ok: true; info: BoletoInfo } | { ok: false; erro: string };

const BASE_DATE = Date.UTC(1997, 9, 7); // 07/10/1997
const DAY = 86_400_000;
const CYCLE_DAYS = 9000; // fatores 1000..9999

const digitsOf = (s: string) => Array.from(s, Number);

/** Módulo 10: pesos 2,1,2,1… da direita; soma os algarismos dos produtos. */
export function mod10(num: string) {
  let sum = 0;
  let weight = 2;
  for (const d of digitsOf(num).reverse()) {
    const p = d * weight;
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(num: string) {
  let sum = 0;
  let weight = 2;
  for (const d of digitsOf(num).reverse()) {
    sum += d * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum;
}

/** DV geral do boleto bancário: 11 − resto; 0, 10 e 11 viram 1. */
export function mod11Bancario(num: string) {
  const dv = 11 - (mod11Sum(num) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da arrecadação: resto 0 ou 1 → 0; senão 11 − resto. */
export function mod11Arrecadacao(num: string) {
  const r = mod11Sum(num) % 11;
  return r === 0 || r === 1 ? 0 : 11 - r;
}

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Vencimento pelo fator; com o reinício de 2025, escolhe o ciclo mais próximo da referência. */
export function dueDateFromFactor(factor: number, referenceIso: string): string | null {
  if (!Number.isInteger(factor) || factor <= 0 || factor > 9999) return null;
  const ref = Date.parse(`${referenceIso}T00:00:00Z`);
  const candidates: number[] = [BASE_DATE + factor * DAY];
  if (factor >= 1000) for (let k = 1; k <= 3; k++) candidates.push(BASE_DATE + (factor + CYCLE_DAYS * k) * DAY);
  const best = Number.isNaN(ref)
    ? candidates[candidates.length - 1]
    : candidates.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
  return isoOf(best);
}

const cents = (s: string) => {
  const n = Number(s);
  return n > 0 ? n / 100 : null;
};

function bancarioFromBarcode(barras: string, referenceIso: string): BoletoResult {
  const dv = Number(barras[4]);
  if (mod11Bancario(barras.slice(0, 4) + barras.slice(5)) !== dv) return { ok: false, erro: "Dígito verificador geral não confere." };
  return {
    ok: true,
    info: {
      tipo: "bancario",
      barras,
      valor: cents(barras.slice(9, 19)),
      vencimento: dueDateFromFactor(Number(barras.slice(5, 9)), referenceIso),
    },
  };
}

function arrecadacaoModulo(barras: string): ((n: string) => number) | null {
  const id = barras[2];
  if (id === "6" || id === "7") return mod10;
  if (id === "8" || id === "9") return mod11Arrecadacao;
  return null;
}

function arrecadacaoFromBarcode(barras: string): BoletoResult {
  const mod = arrecadacaoModulo(barras);
  if (!mod) return { ok: false, erro: "Código de arrecadação com identificador de valor inválido." };
  if (mod(barras.slice(0, 3) + barras.slice(4)) !== Number(barras[3])) return { ok: false, erro: "Dígito verificador geral não confere." };
  const efetivo = barras[2] === "6" || barras[2] === "8";
  return { ok: true, info: { tipo: "arrecadacao", barras, valor: efetivo ? cents(barras.slice(4, 15)) : null, vencimento: null } };
}

/** Código de barras (44) → linha digitável (47 bancário / 48 arrecadação), para mostrar e copiar. */
export function toLinhaDigitavel(barras: string): string | null {
  if (!/^\d{44}$/.test(barras)) return null;
  if (barras[0] === "8") {
    const mod = arrecadacaoModulo(barras);
    if (!mod) return null;
    return [0, 1, 2, 3].map((i) => barras.slice(i * 11, i * 11 + 11)).map((b) => b + mod(b)).join("");
  }
  const f1 = barras.slice(0, 4) + barras.slice(19, 24);
  const f2 = barras.slice(24, 34);
  const f3 = barras.slice(34, 44);
  return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${barras[4]}${barras.slice(5, 19)}`;
}

/**
 * Valida e interpreta uma linha digitável (47 bancário / 48 arrecadação) ou código de barras (44).
 * Aceita espaços, pontos e hífens; qualquer outro caractere é recusado.
 * `referenceIso` (AAAA-MM-DD) decide o ciclo do fator de vencimento.
 */
export function parseBoleto(input: string, referenceIso: string): BoletoResult {
  if (typeof input !== "string" || !/^[\d\s.\-]+$/.test(input)) return { ok: false, erro: "Use só números." };
  const d = input.replace(/\D/g, "");

  if (d.length === 44) return d[0] === "8" ? arrecadacaoFromBarcode(d) : bancarioFromBarcode(d, referenceIso);

  if (d.length === 47) {
    if (d[0] === "8") return { ok: false, erro: "Linha de arrecadação tem 48 dígitos." };
    const fields: [string, string][] = [
      [d.slice(0, 9), d[9]],
      [d.slice(10, 20), d[20]],
      [d.slice(21, 31), d[31]],
    ];
    if (fields.some(([f, dv]) => mod10(f) !== Number(dv))) return { ok: false, erro: "Dígito verificador de um dos campos não confere." };
    const barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    return bancarioFromBarcode(barras, referenceIso);
  }

  if (d.length === 48) {
    if (d[0] !== "8") return { ok: false, erro: "Linha de 48 dígitos precisa começar com 8 (arrecadação)." };
    const mod = arrecadacaoModulo(d);
    if (!mod) return { ok: false, erro: "Código de arrecadação com identificador de valor inválido." };
    for (let i = 0; i < 4; i++) {
      const block = d.slice(i * 12, i * 12 + 11);
      if (mod(block) !== Number(d[i * 12 + 11])) return { ok: false, erro: "Dígito verificador de um dos blocos não confere." };
    }
    const barras = [0, 1, 2, 3].map((i) => d.slice(i * 12, i * 12 + 11)).join("");
    return arrecadacaoFromBarcode(barras);
  }

  return { ok: false, erro: "A linha digitável tem 47 ou 48 dígitos (código de barras: 44)." };
}
