/**
 * Resposta da IA na leitura de boletos/comprovantes. Funções puras.
 * Tudo que vem da IA é DADO não confiável: cada campo é validado no formato estrito;
 * o que não bate vira null e campos desconhecidos são descartados. Nada daqui grava sozinho.
 */
import { parseBRL } from "@/lib/financas/money";
import { MAX_AMOUNT, validDate } from "@/lib/financas/transaction-input";
import { parseBoleto } from "./boleto";

export const DOC_KINDS = ["boleto", "comprovante", "outro"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_LIMITS = { payee: 120, description: 200, rawChars: 20_000 } as const;

export type Extracted = {
  tipo: DocKind;
  beneficiario: string | null;
  valor: number | null;
  vencimento: string | null;
  data_pagamento: string | null;
  codigo: string | null;
  descricao: string | null;
};

export const EMPTY_EXTRACTED: Extracted = {
  tipo: "outro",
  beneficiario: null,
  valor: null,
  vencimento: null,
  data_pagamento: null,
  codigo: null,
  descricao: null,
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g;

/** Texto: uma linha, sem caracteres de controle, cortado no limite. Vazio → null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** Valor positivo em reais (número ou texto "1.234,56"), até o teto do app. */
export function cleanAmount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseBRL(v) : null;
  if (n === null || !Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  const r = Math.round(n * 100) / 100;
  return r > 0 ? r : null;
}

/** Data AAAA-MM-DD válida entre 2000 e 2100. */
export function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return validDate(t) && t >= "2000-01-01" && t <= "2100-12-31" ? t : null;
}

/** Linha digitável/código: só dígitos (espaço, ponto e hífen tolerados) com 44, 47 ou 48 dígitos. */
export function cleanBarcode(v: unknown): string | null {
  if (typeof v !== "string" || !/^[\d\s.\-]+$/.test(v)) return null;
  const d = v.replace(/\D/g, "");
  return d.length === 44 || d.length === 47 || d.length === 48 ? d : null;
}

/** Valida campo a campo um objeto já decodificado. */
export function sanitizeExtracted(raw: unknown): Extracted {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_EXTRACTED };
  const o = raw as Record<string, unknown>;
  return {
    tipo: (DOC_KINDS as readonly unknown[]).includes(o.tipo) ? (o.tipo as DocKind) : "outro",
    beneficiario: cleanText(o.beneficiario, DOC_LIMITS.payee),
    valor: cleanAmount(o.valor),
    vencimento: cleanDate(o.vencimento),
    data_pagamento: cleanDate(o.data_pagamento),
    codigo: cleanBarcode(o.codigo),
    descricao: cleanText(o.descricao, DOC_LIMITS.description),
  };
}

/** Texto bruto da IA → Extracted, ou null se não for um objeto JSON (resposta descartada). */
export function parseExtraction(text: unknown): Extracted | null {
  if (typeof text !== "string" || text.length === 0 || text.length > DOC_LIMITS.rawChars) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return sanitizeExtracted(raw);
}

/** Guardado em fin_documents.extracted: só os campos validados (ou {} quando a IA falhou). */
export function storedExtracted(v: unknown): Extracted | null {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length === 0) return null;
  return sanitizeExtracted(v);
}

export type Reconciled = {
  tipo: DocKind;
  beneficiario: string | null;
  valor: number | null;
  vencimento: string | null;
  data_pagamento: string | null;
  codigo: string | null;
  descricao: string | null;
  /** O código passou nos dígitos verificadores. */
  codigoValido: boolean;
  avisos: string[];
};

const brl = (v: number) => v.toFixed(2).replace(".", ",");
const br = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Junta o que a IA leu com o que o código de barras garante.
 * Se o código passa nos DVs, valor (e vencimento do bancário) do código PREVALECEM; divergências viram aviso.
 */
export function reconcile(ex: Extracted, referenceIso: string): Reconciled {
  const out: Reconciled = { ...ex, codigoValido: false, avisos: [] };
  if (!ex.codigo) return out;
  const parsed = parseBoleto(ex.codigo, referenceIso);
  if (!parsed.ok) {
    out.avisos.push(`A linha digitável lida não passou na conferência dos dígitos (${parsed.erro}) Confira ou apague.`);
    return out;
  }
  out.codigoValido = true;
  out.codigo = parsed.info.barras; // forma canônica (44 dígitos): a mesma conta lida duas vezes bate
  const { valor, vencimento } = parsed.info;
  if (valor !== null) {
    if (ex.valor !== null && Math.round(ex.valor * 100) !== Math.round(valor * 100))
      out.avisos.push(`A IA leu R$ ${brl(ex.valor)}, mas o código de barras diz R$ ${brl(valor)}. Usamos o valor do código.`);
    out.valor = valor;
  }
  if (vencimento !== null) {
    if (ex.vencimento !== null && ex.vencimento !== vencimento)
      out.avisos.push(`A IA leu vencimento ${br(ex.vencimento)}, mas o código de barras diz ${br(vencimento)}. Usamos a data do código.`);
    out.vencimento = vencimento;
  }
  return out;
}
