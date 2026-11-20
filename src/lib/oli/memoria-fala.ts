/**
 * salvar_memoria sem Confirmar só quando é seguro (funções puras; usadas na tela e no servidor).
 * Duas camadas contra memória induzida por texto de terceiros (convite de agenda, PDF, resultado de ferramenta, análise):
 * (a) tela: a rodada fica "com texto de fora" quando roda uma ferramenta que devolve texto de fora (ou chega um arquivo
 *     do "+"); a marca zera na próxima fala do usuário. Com a marca, a memória vai para o painel de Confirmar;
 * (b) servidor: só grava direto se as palavras relevantes do conteúdo coincidirem ≥ 50% com a fala do usuário no turno.
 */
import { normalizeName, type OliToolName } from "./tool-args";

/** Ferramentas cujo resultado traz texto que não foi dito pelo usuário. */
export const FERRAMENTAS_EXTERNAS: ReadonlySet<string> = new Set<OliToolName>([
  "ler_arquivo",
  "ler_ultimo_arquivo",
  "ler_documento",
  "documentos_recentes",
  "analisar",
  "buscar_conversa",
  "buscar_no_app",
  "agenda_periodo",
  "consultar_financas",
  "consultar_saude",
  "consultar_exames_lab",
  "consultar_casa",
  "consultar_pet",
  "consultar_igreja",
  "consultar_memoria",
]);

/** Rodada: fala do usuário desde a última resposta e se já entrou texto de fora. */
export type Rodada = { fala: string; externo: boolean; fechada: boolean };
export const novaRodada = (): Rodada => ({ fala: "", externo: false, fechada: false });

/** Fala do usuário (voz em pedaços ou texto digitado). Depois de uma resposta/ferramenta, começa rodada nova (marca zerada). */
export function rodadaFala(r: Rodada, texto: string): Rodada {
  if (r.fechada) return { fala: texto, externo: false, fechada: false };
  return { ...r, fala: r.fala + texto };
}

/** O modelo começou a responder: a fala desta rodada terminou (a próxima fala abre outra rodada). */
export const rodadaFecha = (r: Rodada): Rodada => ({ ...r, fechada: true });

/** Lote de ferramentas: marca a rodada ANTES de executar (elas rodam em paralelo; salvar_memoria no mesmo lote já vê a marca). */
export function rodadaFerramentas(r: Rodada, nomes: (string | undefined)[]): Rodada {
  return { ...r, fechada: true, externo: r.externo || nomes.some((n) => !!n && FERRAMENTAS_EXTERNAS.has(n)) };
}

/** Arquivo do "+" lido e mandado ao modelo: texto de fora na rodada. */
export const rodadaArquivo = (r: Rodada): Rodada => ({ ...r, externo: true });

/* ---------- Camada do servidor: sobreposição com a fala ---------- */

export const FALA_MAX = 2000;
export const SOBREPOSICAO_MIN = 0.5;
export const PRECISA_CONFIRMAR = "Essa memória precisa de confirmação na tela antes de ser guardada.";

/** Fala do turno: uma linha, sem controles, marcas de direção nem < >, até 2000. */
export function cleanFala(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, FALA_MAX);
}

const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de da do das dos d e ou em no na nos nas num numa ao aos à às pra pro pras pros para por pelo pela pelos pelas " +
    "com sem que se me mim eu tu te ti lhe nos vos meu minha meus minhas teu tua seu sua seus suas nosso nossa " +
    "isso isto esse essa este esta aquele aquela aquilo ele ela eles elas voce voces oli usuario usuaria ja ai la aqui " +
    "mais muito bem so tambem entao tipo ne ta tá ok okay beleza opa ah eh hum por favor favor quero queria lembra lembrar lembre lembrando guarda guardar guarde anota anotar anote"
  )
    .split(/\s+/)
    .map(normalizeName),
);

/** Palavras relevantes: sem acento/caixa, só letras e números, sem stopwords nem palavras de 1 letra. */
export function palavrasRelevantes(texto: string): string[] {
  const out = new Set<string>();
  for (const w of normalizeName(texto).split(/[^a-z0-9]+/)) if (w.length > 1 && !STOPWORDS.has(w)) out.add(w);
  return [...out];
}

/** Mesma palavra ou flexão próxima ("mostra" ~ "mostrar"): a menor (4+ letras) é começo da maior, até 3 letras de diferença. */
function casa(a: string, b: string) {
  if (a === b) return true;
  const [curta, longa] = a.length <= b.length ? [a, b] : [b, a];
  return curta.length >= 4 && longa.length - curta.length <= 3 && longa.startsWith(curta);
}

/** Fração das palavras relevantes do conteúdo que aparecem na fala (0 se o conteúdo não tem nenhuma). */
export function sobreposicao(conteudo: string, fala: string): number {
  const cont = palavrasRelevantes(conteudo);
  if (!cont.length) return 0;
  const f = palavrasRelevantes(fala);
  return cont.filter((w) => f.some((x) => casa(w, x))).length / cont.length;
}

/** Grava direto só com fala presente e sobreposição ≥ 50%. */
export const podeSalvarDireto = (conteudo: string, fala: unknown) => {
  const f = cleanFala(fala);
  return !!f && sobreposicao(conteudo, f) >= SOBREPOSICAO_MIN;
};
