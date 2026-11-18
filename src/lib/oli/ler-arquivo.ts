/**
 * ler_arquivo: o Oli lê o CONTEÚDO de um arquivo já guardado no app (exame, carteirinha, documento da casa,
 * do pet, de Finanças ou arquivo de aula do Carisma no Google Drive) e devolve um resumo fiel.
 * Funções puras (servidor e testes). Regras:
 * - A resposta da IA é DADO não confiável: cada campo é limpo (sem controle, sem < >) e truncado; o que
 *   não passa vira null / é descartado.
 * - O texto que vai para a conversa fica dentro de <documento_lido>…</documento_lido> (mesma proteção do "+").
 * - Nada aqui grava.
 */
import { cleanText } from "@/lib/financas/documentos/schema";
import type { ArquivoTipo } from "./tool-args";
import { DOC_LIDO_CLOSE, DOC_LIDO_OPEN } from "./arquivo";

export const ARQUIVO_TIPO_LABEL: Record<ArquivoTipo, string> = {
  exame: "Exame",
  carteirinha: "Carteirinha de saúde",
  procedimento: "Procedimento",
  vacina: "Vacina",
  casa_documento: "Documento da casa",
  pet_saude: "Saúde do pet",
  pet_veterinario: "Veterinário do pet",
  financas: "Documento de Finanças",
  carisma: "Arquivo de aula do Carisma",
};

/** Tipos de arquivo que a IA recebe. docx vira texto antes (mammoth). */
export type ContentMime = "application/pdf" | "image/jpeg" | "image/png" | "text/plain";

/** Teto do arquivo enviado à IA (os do Supabase já são ≤ 4 MB; os do Drive vão até 20 MB). */
export const OLI_READ_MAX_BYTES = 10 * 1024 * 1024;
/** Teto do texto de um docx enviado à IA. */
export const OLI_READ_MAX_DOCX_CHARS = 100_000;

/**
 * Limites da leitura (18/11/2026; antes resumo 1200, ponto 300, 12 pontos e 2500 no bloco, o que cortava
 * documentos longos). resumo/resposta 4000 ≈ 15 frases longas; 60 pontos de até 400 cobrem um laudo ou um PDF
 * com vários boletos; o bloco para a conversa vai até 12000 (≈ 3 mil tokens, cabe com folga no contexto da
 * sessão de voz) e corta pelo fim (os pontos), nunca a resposta. rawChars limita a resposta bruta da IA.
 */
export const CONTENT_LIMITS = { titulo: 160, resposta: 4000, resumo: 4000, ponto: 400, pontos: 60, docLido: 12000, rawChars: 200_000 } as const;

export type OliContentReading = { titulo: string | null; resposta: string | null; resumo: string; pontos: string[] };

/** Dado para a conversa: sem < > (não abre/fecha blocos), sem controle nem marcas de direção. */
export function dataLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[<>]/g, " ").replace(/[\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, " ");
  return cleanText(t, max);
}

/** Valida a resposta da IA (JSON). Sem resumo → null (descartada). */
export function parseOliContent(text: unknown): OliContentReading | null {
  let raw: unknown = text;
  if (typeof text === "string") {
    if (text.length > CONTENT_LIMITS.rawChars) return null;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const resumo = dataLine(o.resumo, CONTENT_LIMITS.resumo);
  if (!resumo) return null;
  const pontos = Array.isArray(o.pontos)
    ? o.pontos
        .map((p) => dataLine(p, CONTENT_LIMITS.ponto))
        .filter((p): p is string => Boolean(p))
        .slice(0, CONTENT_LIMITS.pontos)
    : [];
  return { titulo: dataLine(o.titulo, CONTENT_LIMITS.titulo), resposta: dataLine(o.resposta, CONTENT_LIMITS.resposta), resumo, pontos };
}

export type LerArquivoData = {
  arquivo: { id: string; tipo: ArquivoTipo; rotulo: string; nome: string | null; pessoa: string | null };
  titulo: string | null;
  /** Pergunta do usuário (já limpa) e a resposta lida do documento. */
  pergunta: string | null;
  resposta: string | null;
  resumo: string;
  pontos: string[];
  /** O mesmo conteúdo para o modelo, marcado como DADO. */
  documento_lido: string;
};

/** Bloco <documento_lido> com o conteúdo lido (uma linha, limitado). */
export function documentoLidoConteudo(rotulo: string, r: OliContentReading, pergunta?: string | null): string {
  const parts = [`arquivo: ${rotulo}`];
  if (r.titulo) parts.push(`título: ${r.titulo}`);
  if (pergunta) parts.push(`pergunta: ${pergunta}`);
  if (r.resposta) parts.push(`resposta: ${r.resposta}`);
  parts.push(`resumo: ${r.resumo}`);
  if (r.pontos.length) parts.push(`pontos: ${r.pontos.join(" | ")}`);
  let body = dataLine(parts.join("; "), CONTENT_LIMITS.docLido * 2) ?? "";
  if (body.length > CONTENT_LIMITS.docLido) body = `${body.slice(0, CONTENT_LIMITS.docLido - 1)}…`;
  return `${DOC_LIDO_OPEN}${body}${DOC_LIDO_CLOSE}`;
}

export function buildLerArquivo(
  meta: { id: string; tipo: ArquivoTipo; nome?: unknown; pessoa?: unknown },
  r: OliContentReading,
  pergunta?: string | null,
): LerArquivoData {
  const rotulo = ARQUIVO_TIPO_LABEL[meta.tipo];
  const nome = dataLine(meta.nome, 160);
  const q = dataLine(pergunta, 500);
  return {
    arquivo: { id: meta.id, tipo: meta.tipo, rotulo, nome, pessoa: dataLine(meta.pessoa, 80) },
    titulo: r.titulo,
    pergunta: q,
    resposta: r.resposta,
    resumo: r.resumo,
    pontos: r.pontos,
    documento_lido: documentoLidoConteudo(nome ? `${rotulo} (${nome})` : rotulo, r, q),
  };
}

/* ---------- Carisma (Google Drive) ---------- */

export const CARISMA_OUTRA_PESSOA =
  "Esse arquivo está no Google Drive de outra pessoa da família. Só quem enviou consegue pedir para o Oli ler; dá para abrir pela tela da aula.";
export const CARISMA_REVOGADO = "O acesso ao Google Drive foi desconectado. Reconecte na tela do Carisma e tente de novo.";
export const ARQUIVO_GRANDE = "Esse arquivo é grande demais para o Oli ler (máximo 10 MB). Use o resumo da aula ou abra o arquivo.";
export const SEM_ARQUIVO = "Esse item não tem arquivo guardado.";
export const ARQUIVO_NAO_ENCONTRADO = "Arquivo não encontrado.";

/**
 * Decide se o arquivo do Drive pode ser lido, com as MESMAS regras do resumo da aula (summarizeLessonAction):
 * só arquivos prontos, baixados com a conta Google da PRÓPRIA pessoa (myAccountById); arquivo da aula
 * compartilhada pelo cônjuge fica no Drive dele e é recusado. Tamanho conferido antes de baixar.
 */
export function carismaReadDecision(f: { status: string; file_size: number }, account: { status: string } | null): string | null {
  if (f.status !== "pronto") return ARQUIVO_NAO_ENCONTRADO;
  if (!account) return CARISMA_OUTRA_PESSOA;
  if (account.status === "revogado") return CARISMA_REVOGADO;
  if (!Number.isFinite(f.file_size) || f.file_size > OLI_READ_MAX_BYTES) return ARQUIVO_GRANDE;
  return null;
}
