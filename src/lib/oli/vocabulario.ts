/**
 * Vocabulário da transcrição de voz do Oli (Gemini Live: inputAudioTranscription.customVocabulary).
 * A doc do Live (conferida em 18/11/2026) aceita até 1000 termos e recomenda ~100: usamos no máximo 100.
 * Função pura (servidor e testes). Os termos da família vêm do banco com a sessão do usuário (RLS) e são DADOS:
 * cada um é limpo (só letras, números e pontuação simples), cortado e deduplicado sem acento/caixa.
 * Nada de saúde fixo no código: remédio só entra se estiver cadastrado e ativo na própria família.
 */

export const MAX_VOCAB_TERMS = 100;
export const MAX_VOCAB_TERM_CHARS = 60;

/** Termos fixos do app (abas, ministérios e palavras que a transcrição errava, ex.: "planície PDF"). */
export const OLI_VOCAB_FIXO = [
  "Oli",
  "Oliveira's",
  "Finanças",
  "Saúde",
  "Casa",
  "Pet",
  "Igreja",
  "Agenda",
  "Carisma",
  "Consolidação",
  "Vida Devocional",
  "propósito",
  "conta fixa",
  "conta avulsa",
  "boleto",
  "comprovante",
  "lançamento",
  "carteirinha",
  "PDF",
] as const;

/** Um termo pronto para o vocabulário, ou null (vazio, só símbolos, curto ou de outro tipo). */
export function sanitizeVocabTerm(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}' .&-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < 2 || !/\p{L}/u.test(t)) return null;
  return t.length > MAX_VOCAB_TERM_CHARS ? t.slice(0, MAX_VOCAB_TERM_CHARS).trimEnd() : t;
}

const vocabKey = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();

/**
 * Lista final: fixos primeiro, depois os grupos da família na ordem dada (pessoas, pets, remédios, contas…),
 * sem repetir (acento e caixa não contam) e com no máximo `max` termos. Nome com sobrenome entra também só o
 * primeiro nome ("Karen Oliveira" → "Karen Oliveira", "Karen").
 */
export function buildCustomVocabulary(groups: readonly (readonly unknown[])[], max = MAX_VOCAB_TERMS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const t = sanitizeVocabTerm(raw);
    if (!t) return;
    const k = vocabKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const term of OLI_VOCAB_FIXO) push(term);
  for (const group of groups) {
    for (const raw of group) {
      if (out.length >= max) return out.slice(0, max);
      push(raw);
    }
  }
  return out.slice(0, max);
}

/** Nomes de pessoas: o nome completo e o primeiro nome. */
export function withFirstNames(names: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    out.push(n);
    const first = n.trim().split(/\s+/)[0];
    if (first && first !== n.trim()) out.push(first);
  }
  return out;
}
