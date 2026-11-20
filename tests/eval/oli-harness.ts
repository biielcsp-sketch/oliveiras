/**
 * Harness da simulação do Oli com o modelo real (nível 2). Não executa ferramenta nenhuma: só observa a primeira
 * chamada de ferramenta e/ou o texto até o turnComplete. A conexão é injetada (Gemini Live no script, simulada nos
 * testes unitários), para o mesmo código ser testado sem a chave.
 */
import type { LiveServerMessage } from "@google/genai";
import { buildSystemInstruction, type HistoryForPrompt } from "../../src/lib/oli/prompt";

export const NENHUMA = "nenhuma";

export type Cenario = {
  id: string;
  /** Fala do usuário (nomes genéricos; nunca dados reais da família). */
  texto: string;
  /** Ferramentas aceitas na 1ª chamada; NENHUMA = responder só com texto também vale. */
  aceitas: string[];
  /** Frases que reprovam se aparecerem na resposta (texto anterior à 1ª ferramenta ou até o turnComplete). */
  proibidas: RegExp[];
  /** Ferramentas que nunca podem aparecer no 1º lote de chamadas (ex.: criar_evento para dentista). */
  ferramentasProibidas?: string[];
  /** Se responder só com texto, o texto precisa casar com ao menos uma destas. */
  exigidas?: RegExp[];
  /** Conversa anterior injetada no systemInstruction, como o app faz. */
  historico?: HistoryForPrompt[];
};

export type Tentativa = {
  ok: boolean;
  ferramenta: string | null;
  texto: string;
  proibida: string | null;
  motivo: string | null;
};

export type ResultadoCenario = { cenario: Cenario; acertos: number; total: number; ok: boolean; tentativas: Tentativa[] };

export interface SessaoLive {
  enviarTexto(texto: string): void;
  responderFerramentas(respostas: { id?: string; name?: string; response: Record<string, unknown> }[]): void;
  fechar(): void;
}

export type Conectar = (opts: {
  systemInstruction: string;
  onMessage: (m: LiveServerMessage) => void;
  onError: (e: unknown) => void;
  onClose: () => void;
}) => Promise<SessaoLive>;

/** Resultado fixo e vazio para fechar o turno, se for preciso; nunca executa nada. */
export const RESULTADO_VAZIO = { output: { simulacao: true, itens: [] } };

/** Tira a chave de qualquer texto que vá para a tela (mensagens de erro do SDK incluídas). */
export function redigir(texto: string, segredos: (string | undefined)[]) {
  let out = texto;
  for (const s of segredos) if (s && s.length >= 4) out = out.split(s).join("***");
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, "***");
}

function primeiraProibida(texto: string, proibidas: RegExp[]) {
  for (const re of proibidas) {
    const m = texto.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Julga uma tentativa a partir do que foi observado. */
export function julgar(c: Cenario, obs: { ferramentas: string[]; texto: string; erro?: string }): Tentativa {
  const ferramenta = obs.ferramentas[0] ?? null;
  const texto = obs.texto.trim();
  const base = { ferramenta, texto, proibida: null as string | null };
  if (obs.erro) return { ...base, ok: false, motivo: obs.erro };
  const proibida = primeiraProibida(texto, c.proibidas);
  if (proibida) return { ...base, proibida, ok: false, motivo: "frase proibida" };
  const vetada = obs.ferramentas.find((f) => c.ferramentasProibidas?.includes(f));
  if (vetada) return { ...base, ok: false, motivo: `ferramenta proibida: ${vetada}` };
  if (ferramenta) {
    if (c.aceitas.includes(ferramenta)) return { ...base, ok: true, motivo: null };
    return { ...base, ok: false, motivo: `ferramenta não aceita: ${ferramenta}` };
  }
  if (!c.aceitas.includes(NENHUMA)) return { ...base, ok: false, motivo: "não chamou ferramenta" };
  if (!texto) return { ...base, ok: false, motivo: "resposta vazia" };
  if (c.exigidas?.length && !c.exigidas.some((re) => re.test(texto))) {
    return { ...base, ok: false, motivo: "texto sem o esperado" };
  }
  return { ...base, ok: true, motivo: null };
}

/** Uma tentativa: conecta, manda o texto, para na 1ª chamada de ferramenta ou no turnComplete (ou no timeout). */
export async function rodarTentativa(c: Cenario, conectar: Conectar, opts: { timeoutMs: number; hoje?: string }): Promise<Tentativa> {
  const systemInstruction = buildSystemInstruction([], opts.hoje, c.historico ?? []);
  let texto = "";
  let sessao: SessaoLive | null = null;
  return new Promise<Tentativa>((resolve) => {
    let fim = false;
    const terminar = (obs: { ferramentas: string[]; erro?: string }) => {
      if (fim) return;
      fim = true;
      clearTimeout(timer);
      try {
        sessao?.fechar();
      } catch {}
      resolve(julgar(c, { ...obs, texto }));
    };
    const timer = setTimeout(() => terminar({ ferramentas: [], erro: "timeout" }), opts.timeoutMs);
    const onMessage = (m: LiveServerMessage) => {
      if (fim) return;
      const sc = m.serverContent;
      if (sc?.outputTranscription?.text) texto += sc.outputTranscription.text;
      for (const p of sc?.modelTurn?.parts ?? []) if (p.text && !p.thought) texto += p.text;
      const calls = m.toolCall?.functionCalls ?? [];
      if (calls.length) {
        // Nada é executado: o resultado é fixo e vazio, só para não deixar o turno pendurado.
        try {
          sessao?.responderFerramentas(calls.map((fc) => ({ id: fc.id, name: fc.name, response: RESULTADO_VAZIO })));
        } catch {}
        terminar({ ferramentas: calls.map((fc) => fc.name ?? "?") });
        return;
      }
      if (sc?.turnComplete) terminar({ ferramentas: [] });
    };
    conectar({
      systemInstruction,
      onMessage,
      onError: () => terminar({ ferramentas: [], erro: "erro de conexão" }),
      onClose: () => terminar({ ferramentas: [], erro: "conexão fechada" }),
    })
      .then((s) => {
        sessao = s;
        if (fim) {
          try {
            s.fechar();
          } catch {}
          return;
        }
        s.enviarTexto(c.texto);
      })
      .catch(() => terminar({ ferramentas: [], erro: "falha ao conectar" }));
  });
}

/** Roda o cenário N vezes (padrão 3); passa com pelo menos `minimo` acertos (padrão 2). */
export async function rodarCenario(
  c: Cenario,
  conectar: Conectar,
  opts: { timeoutMs: number; tentativas?: number; minimo?: number; hoje?: string },
): Promise<ResultadoCenario> {
  const total = opts.tentativas ?? 3;
  const minimo = opts.minimo ?? 2;
  const tentativas: Tentativa[] = [];
  for (let i = 0; i < total; i++) tentativas.push(await rodarTentativa(c, conectar, opts));
  const acertos = tentativas.filter((t) => t.ok).length;
  return { cenario: c, acertos, total, ok: acertos >= minimo, tentativas };
}

export async function rodarTodos(
  cenarios: Cenario[],
  conectar: Conectar,
  opts: { timeoutMs: number; tentativas?: number; minimo?: number; hoje?: string },
) {
  const out: ResultadoCenario[] = [];
  for (const c of cenarios) out.push(await rodarCenario(c, conectar, opts));
  return out;
}

const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Tabela: cenário, acertos, ferramentas chamadas e trecho proibido encontrado (sem a fala do modelo inteira). */
export function formatarTabela(res: ResultadoCenario[]) {
  const linhas = res.map((r) => {
    const ferramentas = r.tentativas.map((t) => t.ferramenta ?? "-").join(", ");
    const proibido = r.tentativas.map((t) => t.proibida).filter(Boolean).join(" | ");
    const motivos = r.tentativas.map((t) => t.motivo).filter(Boolean).join(" | ");
    return [r.ok ? "OK" : "FALHA", r.cenario.id, `${r.acertos}/${r.total}`, ferramentas, corta(proibido, 60), corta(motivos, 80)];
  });
  const cab = ["", "cenário", "acertos", "ferramenta (1ª chamada)", "trecho proibido", "motivo"];
  const todas = [cab, ...linhas];
  const larg = cab.map((_, i) => Math.max(...todas.map((l) => l[i].length)));
  return todas.map((l) => l.map((c, i) => c.padEnd(larg[i])).join("  ").trimEnd()).join("\n");
}
