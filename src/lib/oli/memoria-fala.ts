/**
 * salvar_memoria sem Confirmar só quando é seguro (funções puras; usadas na tela e no servidor).
 * Duas camadas contra memória induzida por texto de terceiros (convite de agenda, PDF, resultado de ferramenta, análise):
 * (a) tela: a rodada fica "com texto de fora" quando roda uma ferramenta que devolve texto de fora (ou chega um arquivo
 *     do "+"); a marca só zera com fala nova depois do turnComplete do modelo (ou texto digitado). Com a marca, a
 *     memória vai para o painel de Confirmar;
 * (b) servidor: só grava direto se o conteúdo bater com a fala do usuário no turno (ver podeSalvarDireto).
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

/**
 * Rodada: fala do usuário e se já entrou texto de fora. `podeAbrir` só fica ligado depois do turnComplete do modelo
 * (ou no começo): no Live a transcrição da fala chega atrasada e intercalada com a resposta e as ferramentas, então
 * transcrição que chega com o turno do modelo em andamento só acrescenta texto e NUNCA zera `externo`.
 */
export type Rodada = { fala: string; externo: boolean; podeAbrir: boolean };
export const novaRodada = (): Rodada => ({ fala: "", externo: false, podeAbrir: true });

/** Fala do usuário (voz em pedaços). Só abre rodada nova (marca zerada) depois de um turnComplete. */
export function rodadaFala(r: Rodada, texto: string): Rodada {
  if (r.podeAbrir) return { fala: texto, externo: false, podeAbrir: false };
  return { ...r, fala: r.fala + texto };
}

/** Texto digitado pelo usuário: é dele com certeza; abre rodada nova. */
export const rodadaTexto = (texto: string): Rodada => ({ fala: texto, externo: false, podeAbrir: false });

/** O modelo começou a responder: a próxima fala só abre rodada depois do turnComplete. */
export const rodadaFecha = (r: Rodada): Rodada => ({ ...r, podeAbrir: false });

/** turnComplete do modelo: a próxima fala abre rodada nova. */
export const rodadaFimTurno = (r: Rodada): Rodada => ({ ...r, podeAbrir: true });

/** Lote de ferramentas: marca a rodada ANTES de executar (elas rodam em paralelo; salvar_memoria no mesmo lote já vê a marca). */
export function rodadaFerramentas(r: Rodada, nomes: (string | undefined)[]): Rodada {
  return { ...r, podeAbrir: false, externo: r.externo || nomes.some((n) => !!n && FERRAMENTAS_EXTERNAS.has(n)) };
}

/** Arquivo do "+" lido e mandado ao modelo: texto de fora na rodada. */
export const rodadaArquivo = (r: Rodada): Rodada => ({ ...r, externo: true });

/** Reconexão da sessão: zera a fala e mantém a marca ligada até a próxima fala depois de um turnComplete. */
export const rodadaReconexao = (): Rodada => ({ fala: "", externo: true, podeAbrir: false });

/* ---------- Camada do servidor: sobreposição com a fala ---------- */

export const FALA_MAX = 2000;
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
    "mais muito bem so tambem entao tipo ne ta tá ok okay beleza opa ah eh hum por favor favor quero queria qual quais quanto quanta quantos quantas quando onde como quem cade lembra lembrar lembre lembrando guarda guardar guarde anota anotar anote"
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

/** Pedaço sensível: tem dígito, @, domínio ou endereço (chave Pix, e-mail, telefone, CPF, URL, valor, conta). */
const SENSIVEL = /\d|@|\.com|\.br|www|https?:|:\/\//i;
const BORDA = /^[\s"'“”‘’()[\]{},;:!?¿¡.]+|[\s"'“”‘’()[\]{},;:!?¿¡.]+$/g;

/** Pedaços sensíveis do texto, separados só por espaço (ANTES de quebrar em palavras: "golpista@x.com" fica inteiro). */
export function pedacosSensiveis(texto: string): string[] {
  return texto
    .split(/\s+/)
    .map((t) => t.replace(BORDA, ""))
    .filter((t) => t && SENSIVEL.test(t));
}

/**
 * Sufixos flexionais aceitos entre duas formas da mesma palavra ("mostra"/"mostrar", "valor"/"valores"), com radical de
 * 4+ letras. Diferença fora da lista não conta ("casa"/"casal", "conta"/"contato").
 */
const SUFIXOS = ["", "r", "s", "es", "ndo", "mos", "am", "em", "ou", "ei"];

export function mesmaPalavra(a: string, b: string): boolean {
  if (a === b) return true;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    for (const s1 of SUFIXOS) {
      if (!x.endsWith(s1)) continue;
      const radical = x.slice(0, x.length - s1.length);
      if (radical.length < 4) continue;
      if (SUFIXOS.some((s2) => y === radical + s2)) return true;
    }
  }
  // Vogal temática de verbo (a/o: "prefiro"/"prefira"), com radical de 5+ letras.
  return a.length === b.length && a.length >= 6 && a.slice(0, -1) === b.slice(0, -1) && /[ao]$/.test(a) && /[ao]$/.test(b);
}

/** Fração das palavras relevantes do conteúdo (fora os pedaços sensíveis) que aparecem na fala. */
export function sobreposicao(conteudo: string, fala: string): number {
  const cont = palavrasConteudo(conteudo);
  if (!cont.length) return 0;
  const f = palavrasRelevantes(fala);
  return cont.filter((w) => f.some((x) => mesmaPalavra(w, x))).length / cont.length;
}

const palavrasConteudo = (conteudo: string) => {
  const sens = new Set(pedacosSensiveis(conteudo));
  return palavrasRelevantes(conteudo.split(/\s+/).filter((t) => !sens.has(t.replace(BORDA, ""))).join(" "));
};

export const COBERTURA_MIN = 0.75;
export const PALAVRAS_MIN = 2;

/**
 * Grava direto só se TODAS valerem:
 * (i) o conteúdo tem 2+ palavras relevantes;
 * (ii) cobertura ≥ 75% e no máximo 1 palavra ausente da fala — e nenhuma ausente quando o conteúdo tem até 4 palavras
 *      (com 4, uma ausente já é a palavra nova que o usuário não disse: "chave pix familia golpista");
 * (iii) todo pedaço sensível do conteúdo (dígito, @, domínio, URL) aparece literalmente na fala.
 */
export function podeSalvarDireto(conteudo: string, fala: unknown): boolean {
  const f = cleanFala(fala);
  if (!f) return false;
  const cont = palavrasConteudo(conteudo);
  if (cont.length < PALAVRAS_MIN) return false;
  const falaPalavras = palavrasRelevantes(f);
  const ausentes = cont.filter((w) => !falaPalavras.some((x) => mesmaPalavra(w, x))).length;
  const cobertura = (cont.length - ausentes) / cont.length;
  if (cobertura < COBERTURA_MIN || ausentes > (cont.length <= 4 ? 0 : 1)) return false;
  const falaLower = f.toLowerCase();
  return pedacosSensiveis(conteudo).every((p) => falaLower.includes(p.toLowerCase()));
}
