/**
 * "+" do Oli: leitura de um arquivo (PDF/JPG) com IA e roteamento para o módulo certo do app.
 * Funções puras (servidor e navegador). Regras:
 * - Tudo que vem da IA é DADO não confiável: cada campo é validado no formato estrito; o resto vira null.
 * - A IA só classifica e lê campos. O destino sai de uma tabela fixa (OLI_FILE_ROUTE), nunca de texto do modelo.
 * - Nada daqui grava: o painel do Oli mostra o que foi lido e só grava no toque em Confirmar,
 *   pelas mesmas server actions dos formulários de cada módulo (que validam tudo de novo).
 */
import { cleanAmount, cleanBarcode, cleanDate, cleanText, type Extracted } from "@/lib/financas/documentos/schema";
import { DOC_KINDS as CASA_DOC_KINDS, DOC_KIND_LABEL as CASA_DOC_LABEL, type DocKind as CasaDocKind } from "@/lib/casa/types";
import { PET_HEALTH_KINDS, PET_HEALTH_LABEL, type PetHealthKind } from "@/lib/casa/pet";
import { LIMITS as SAUDE } from "@/lib/saude/input";
import { LIMITS as CASA } from "@/lib/casa/input";
import { PET_LIMITS } from "@/lib/casa/pet-input";
import { matchByName } from "./tool-args";

/* ---------- Tipos de documento e destinos ---------- */

export const OLI_FILE_KINDS = [
  "boleto",
  "comprovante",
  "exame",
  "vacina",
  "procedimento",
  "carteirinha",
  "receita",
  "casa",
  "pet",
  "outro",
] as const;
export type OliFileKind = (typeof OLI_FILE_KINDS)[number];

export const OLI_FILE_KIND_LABEL: Record<OliFileKind, string> = {
  boleto: "Boleto",
  comprovante: "Comprovante",
  exame: "Exame",
  vacina: "Vacina",
  procedimento: "Procedimento",
  carteirinha: "Carteirinha de saúde",
  receita: "Receita / medicamento",
  casa: "Documento da casa",
  pet: "Documento do pet",
  outro: "Outro",
};

export const OLI_FILE_DESTS = [
  "financas",
  "saude_exame",
  "saude_vacina",
  "saude_procedimento",
  "saude_carteirinha",
  "saude_medicamento",
  "casa_documento",
  "pet_saude",
  "nenhum",
] as const;
export type OliFileDest = (typeof OLI_FILE_DESTS)[number];

export const OLI_FILE_DEST_LABEL: Record<OliFileDest, string> = {
  financas: "Finanças › Documentos (conferência)",
  saude_exame: "Saúde › Exames",
  saude_vacina: "Saúde › Vacinas",
  saude_procedimento: "Saúde › Procedimentos",
  saude_carteirinha: "Saúde › Carteirinhas",
  saude_medicamento: "Saúde › Medicamentos",
  casa_documento: "Casa › Documentos",
  pet_saude: "Casa › Pet (saúde)",
  nenhum: "Não guardar (só o resumo)",
};

/** Tabela fixa tipo → destino. */
export const OLI_FILE_ROUTE: Record<OliFileKind, OliFileDest> = {
  boleto: "financas",
  comprovante: "financas",
  exame: "saude_exame",
  vacina: "saude_vacina",
  procedimento: "saude_procedimento",
  carteirinha: "saude_carteirinha",
  receita: "saude_medicamento",
  casa: "casa_documento",
  pet: "pet_saude",
  outro: "nenhum",
};

export const routeFor = (kind: OliFileKind): OliFileDest => OLI_FILE_ROUTE[kind] ?? "nenhum";
export const isOliFileDest = (v: unknown): v is OliFileDest => (OLI_FILE_DESTS as readonly unknown[]).includes(v);

/* ---------- Leitura (resposta da IA) ---------- */

export type OliFileReading = {
  tipo: OliFileKind;
  resumo: string | null;
  /** Nome de quem é o documento (paciente, titular ou pet), só como pista para a seleção. */
  pessoa: string | null;
  nome: string | null;
  data: string | null;
  proxima_data: string | null;
  instituicao: string | null;
  profissional: string | null;
  detalhe: string | null;
  numero: string | null;
  categoria_casa: CasaDocKind | null;
  categoria_pet: PetHealthKind | null;
  beneficiario: string | null;
  valor: number | null;
  vencimento: string | null;
  data_pagamento: string | null;
  codigo: string | null;
};

export const OLI_FILE_LIMITS = {
  resumo: 300,
  pessoa: 80,
  nome: 160,
  instituicao: 120,
  profissional: 120,
  detalhe: 500,
  numero: 60,
  beneficiario: 120,
  rawChars: 20_000,
} as const;

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);

/** Valida campo a campo um objeto já decodificado; desconhecidos são descartados. */
export function sanitizeOliReading(raw: unknown): OliFileReading {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const L = OLI_FILE_LIMITS;
  return {
    tipo: oneOf(OLI_FILE_KINDS, o.tipo) ?? "outro",
    resumo: cleanText(o.resumo, L.resumo),
    pessoa: cleanText(o.pessoa, L.pessoa),
    nome: cleanText(o.nome, L.nome),
    data: cleanDate(o.data),
    proxima_data: cleanDate(o.proxima_data),
    instituicao: cleanText(o.instituicao, L.instituicao),
    profissional: cleanText(o.profissional, L.profissional),
    detalhe: cleanText(o.detalhe, L.detalhe),
    numero: cleanText(o.numero, L.numero),
    categoria_casa: oneOf(CASA_DOC_KINDS, o.categoria_casa),
    categoria_pet: oneOf(PET_HEALTH_KINDS, o.categoria_pet),
    beneficiario: cleanText(o.beneficiario, L.beneficiario),
    valor: cleanAmount(o.valor),
    vencimento: cleanDate(o.vencimento),
    data_pagamento: cleanDate(o.data_pagamento),
    codigo: cleanBarcode(o.codigo),
  };
}

/** Texto bruto da IA → leitura validada, ou null se não for um objeto JSON (resposta descartada). */
export function parseOliReading(text: unknown): OliFileReading | null {
  if (typeof text !== "string" || text.length === 0 || text.length > OLI_FILE_LIMITS.rawChars) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return sanitizeOliReading(raw);
}

/* ---------- Painel: campos editáveis por destino ---------- */

export type OliFileOption = { id: string; name: string };
export type OliFileOptions = { pessoas: OliFileOption[]; pets: OliFileOption[] };

export type OliFileField = {
  name: string;
  label: string;
  type: "text" | "date" | "textarea" | "select";
  required?: boolean;
  max?: number;
  /** Lista de opções (select): fixa ou "pessoas"/"pets" (vindas do servidor). */
  options?: readonly { value: string; label: string }[] | "pessoas" | "pets";
};

const casaKindOptions = CASA_DOC_KINDS.map((k) => ({ value: k, label: CASA_DOC_LABEL[k] }));
const petKindOptions = PET_HEALTH_KINDS.map((k) => ({ value: k, label: PET_HEALTH_LABEL[k] }));
const pessoa: OliFileField = { name: "member_id", label: "De quem é", type: "select", required: true, options: "pessoas" };

/** Mesmos nomes de campo dos formulários de cada módulo (as server actions leem esses nomes). */
export const OLI_FILE_FIELDS: Record<OliFileDest, readonly OliFileField[]> = {
  // Finanças: o resto (conta fixa ou avulsa, valor, vencimento) se confere na tela de conferência.
  financas: [
    {
      name: "tipo",
      label: "Tipo",
      type: "select",
      required: true,
      options: [
        { value: "boleto", label: "Boleto (a pagar)" },
        { value: "comprovante", label: "Comprovante (já pago)" },
      ],
    },
  ],
  nenhum: [],
  saude_exame: [
    pessoa,
    { name: "name", label: "Exame", type: "text", required: true, max: SAUDE.examName },
    { name: "exam_date", label: "Data", type: "date" },
    { name: "lab", label: "Laboratório", type: "text", max: SAUDE.lab },
    { name: "requested_by", label: "Pedido por", type: "text", max: SAUDE.requestedBy },
    { name: "result_summary", label: "Resumo do resultado", type: "textarea", max: SAUDE.summary },
  ],
  saude_vacina: [
    pessoa,
    { name: "name", label: "Vacina", type: "text", required: true, max: SAUDE.vaccineName },
    { name: "dose_label", label: "Dose", type: "text", max: SAUDE.doseLabel },
    { name: "applied_on", label: "Aplicada em", type: "date" },
    { name: "next_dose_on", label: "Próxima dose", type: "date" },
    { name: "place", label: "Local", type: "text", max: SAUDE.place },
    { name: "lot", label: "Lote", type: "text", max: SAUDE.lot },
  ],
  saude_procedimento: [
    pessoa,
    { name: "name", label: "Procedimento", type: "text", required: true, max: SAUDE.procName },
    { name: "performed_on", label: "Data", type: "date" },
    { name: "place", label: "Local", type: "text", max: SAUDE.place },
    { name: "doctor", label: "Médico", type: "text", max: SAUDE.doctor },
    { name: "notes", label: "Observações", type: "textarea", max: SAUDE.procNotes },
  ],
  saude_carteirinha: [
    pessoa,
    { name: "operator", label: "Operadora", type: "text", required: true, max: SAUDE.operator },
    { name: "card_number", label: "Número", type: "text", max: SAUDE.cardNumber },
    { name: "plan_name", label: "Plano", type: "text", max: SAUDE.plan },
    { name: "valid_until", label: "Validade", type: "date" },
  ],
  saude_medicamento: [
    pessoa,
    { name: "name", label: "Medicamento", type: "text", required: true, max: SAUDE.medName },
    { name: "dosage", label: "Dose", type: "text", max: SAUDE.dosage },
    { name: "frequency", label: "Frequência", type: "text", max: SAUDE.frequency },
    { name: "started_on", label: "Início", type: "date" },
    { name: "prescribed_by", label: "Prescrito por", type: "text", max: SAUDE.doctor },
  ],
  casa_documento: [
    { name: "kind", label: "Tipo", type: "select", required: true, options: casaKindOptions },
    { name: "title", label: "Título", type: "text", required: true, max: CASA.docTitle },
    { name: "product", label: "Produto", type: "text", max: CASA.docProduct },
    { name: "store", label: "Loja", type: "text", max: CASA.docStore },
    { name: "purchase_date", label: "Data da compra", type: "date" },
    { name: "warranty_until", label: "Garantia até", type: "date" },
    { name: "amount", label: "Valor (R$)", type: "text", max: 20 },
  ],
  pet_saude: [
    { name: "pet_id", label: "Pet", type: "select", required: true, options: "pets" },
    { name: "kind", label: "Tipo", type: "select", required: true, options: petKindOptions },
    { name: "name", label: "Nome", type: "text", required: true, max: PET_LIMITS.healthName },
    { name: "dose", label: "Dose", type: "text", max: PET_LIMITS.dose },
    { name: "applied_on", label: "Aplicado em", type: "date" },
    { name: "next_due_on", label: "Próxima dose", type: "date" },
  ],
};

/** O destino guarda o arquivo junto? (Medicamento não tem anexo em Saúde.) */
export const OLI_FILE_KEEPS_FILE: Record<OliFileDest, boolean> = {
  financas: true,
  saude_exame: true,
  saude_vacina: true,
  saude_procedimento: true,
  saude_carteirinha: true,
  saude_medicamento: false,
  casa_documento: true,
  pet_saude: true,
  nenhum: false,
};

const brMoney = (v: number) => v.toFixed(2).replace(".", ",");
const s = (v: string | null | undefined) => v ?? "";

/** Seleção de pessoa/pet: o nome lido só pré-seleciona se bater com UMA opção; com uma opção só, ela vem marcada. */
export function pickOption(options: OliFileOption[], hint: string | null): string {
  if (hint) {
    const found = matchByName(options, hint);
    if (found) return found.id;
  }
  return options.length === 1 ? options[0].id : "";
}

/** Valores iniciais (editáveis) do painel para o destino escolhido. */
export function prefillFor(r: OliFileReading, dest: OliFileDest, opts: OliFileOptions): Record<string, string> {
  const member_id = pickOption(opts.pessoas, r.pessoa);
  switch (dest) {
    case "saude_exame":
      return { member_id, name: s(r.nome), exam_date: s(r.data), lab: s(r.instituicao), requested_by: s(r.profissional), result_summary: s(r.detalhe) };
    case "saude_vacina":
      return { member_id, name: s(r.nome), dose_label: s(r.detalhe), applied_on: s(r.data), next_dose_on: s(r.proxima_data), place: s(r.instituicao), lot: s(r.numero) };
    case "saude_procedimento":
      return { member_id, name: s(r.nome), performed_on: s(r.data), place: s(r.instituicao), doctor: s(r.profissional), notes: s(r.detalhe) };
    case "saude_carteirinha":
      return { member_id, operator: s(r.instituicao), card_number: s(r.numero), plan_name: s(r.detalhe), valid_until: s(r.proxima_data) };
    case "saude_medicamento":
      return { member_id, name: s(r.nome), dosage: s(r.detalhe), frequency: "", started_on: s(r.data), prescribed_by: s(r.profissional) };
    case "casa_documento":
      return {
        kind: r.categoria_casa ?? "outro",
        title: s(r.nome),
        product: s(r.detalhe),
        store: s(r.instituicao),
        purchase_date: s(r.data),
        warranty_until: s(r.proxima_data),
        amount: r.valor !== null ? brMoney(r.valor) : "",
      };
    case "pet_saude":
      return {
        pet_id: pickOption(opts.pets, r.pessoa),
        kind: r.categoria_pet ?? "vacina",
        name: s(r.nome),
        dose: s(r.detalhe),
        applied_on: s(r.data),
        next_due_on: s(r.proxima_data),
      };
    case "financas":
      return { tipo: r.tipo === "comprovante" ? "comprovante" : "boleto" };
    case "nenhum":
      return {};
  }
}

/** Só os nomes de campo do destino entram no FormData (o resto do formulário é ignorado). */
export function formFieldsFor(dest: OliFileDest, values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of OLI_FILE_FIELDS[dest]) out[f.name] = typeof values[f.name] === "string" ? (values[f.name] as string) : "";
  return out;
}

/** Leitura → sugestões da conferência de Finanças (mesmo formato do `extracted` de fin_documents). */
export function financeExtracted(r: OliFileReading): Extracted {
  return {
    tipo: r.tipo === "boleto" || r.tipo === "comprovante" ? r.tipo : "outro",
    beneficiario: r.beneficiario,
    valor: r.valor,
    vencimento: r.vencimento,
    data_pagamento: r.data_pagamento,
    codigo: r.codigo,
    descricao: cleanText(r.nome ?? r.resumo, 60),
  };
}

/* ---------- Conversa: o que vai para o Oli falar ---------- */

export const DOC_LIDO_OPEN = "<documento_lido>";
export const DOC_LIDO_CLOSE = "</documento_lido>";
export const MAX_DOC_LIDO_CHARS = 700;

/** Dado para o prompt: uma linha, sem < > (não fecha nem abre o bloco), sem controle. */
const dataText = (v: string) =>
  v
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Texto curto enviado à sessão de voz depois da leitura: tipo, destino e alguns campos, dentro de
 * <documento_lido>…</documento_lido> (dado, nunca instrução). O Oli só comenta; a tela pede a confirmação.
 */
export function documentoLidoText(r: OliFileReading, dest: OliFileDest): string {
  const parts = [`tipo: ${OLI_FILE_KIND_LABEL[r.tipo]}`, `destino sugerido: ${OLI_FILE_DEST_LABEL[dest]}`];
  if (r.nome) parts.push(`nome: ${r.nome}`);
  if (r.pessoa) parts.push(`de: ${r.pessoa}`);
  if (r.beneficiario) parts.push(`beneficiário: ${r.beneficiario}`);
  if (r.valor !== null) parts.push(`valor: R$ ${brMoney(r.valor)}`);
  if (r.vencimento) parts.push(`vencimento: ${r.vencimento}`);
  if (r.data) parts.push(`data: ${r.data}`);
  if (r.resumo) parts.push(`resumo: ${r.resumo}`);
  let body = dataText(parts.join("; "));
  if (body.length > MAX_DOC_LIDO_CHARS) body = `${body.slice(0, MAX_DOC_LIDO_CHARS - 1)}…`;
  return [
    "O usuário enviou um arquivo pela tela e ele foi lido. Diga em poucas palavras o que encontrou e lembre que a tela pede para conferir e tocar em Confirmar.",
    `${DOC_LIDO_OPEN}${body}${DOC_LIDO_CLOSE}`,
  ].join("\n");
}
