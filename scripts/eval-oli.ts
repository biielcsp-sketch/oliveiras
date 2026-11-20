/**
 * Simulação do Oli com o modelo real (nível 2): `npm run eval:oli` (precisa de GEMINI_API_KEY).
 * Mesmo modelo (GEMINI_LIVE_MODEL ou o padrão do app), mesma persona e mesmas OLI_TOOLS, importadas do código.
 * Sem memórias; histórico só nos cenários que o injetam. Nenhuma ferramenta é executada.
 *
 * O app usa resposta em ÁUDIO (modelos de áudio nativo não aceitam TEXT); aqui a entrada é texto e a fala do
 * modelo é lida pela transcrição. EVAL_OLI_MODALIDADE=TEXT força resposta em texto, se o modelo aceitar.
 * Opções: EVAL_OLI_TENTATIVAS (3), EVAL_OLI_MINIMO (2), EVAL_OLI_TIMEOUT_MS (30000), EVAL_OLI_FILTRO (id contém).
 */
import { GoogleGenAI, Modality } from "@google/genai";
import { OLI_API_VERSION, OLI_DEFAULT_MODEL } from "../src/lib/oli/access";
import { OLI_TOOLS } from "../src/lib/oli/prompt";
import { todaySP } from "../src/lib/financas/today";
import { OLI_CENARIOS } from "../tests/eval/oli-cenarios";
import { formatarTabela, redigir, rodarTodos, type Conectar } from "../tests/eval/oli-harness";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY ausente.");
    return 2;
  }
  const model = process.env.GEMINI_LIVE_MODEL || OLI_DEFAULT_MODEL;
  const modalidade = process.env.EVAL_OLI_MODALIDADE === "TEXT" ? Modality.TEXT : Modality.AUDIO;
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  const tentativas = num(process.env.EVAL_OLI_TENTATIVAS, 3);
  const minimo = Math.min(num(process.env.EVAL_OLI_MINIMO, 2), tentativas);
  const timeoutMs = num(process.env.EVAL_OLI_TIMEOUT_MS, 30_000);
  const filtro = process.env.EVAL_OLI_FILTRO;
  const cenarios = filtro ? OLI_CENARIOS.filter((c) => c.id.includes(filtro)) : OLI_CENARIOS;

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: OLI_API_VERSION } });
  const conectar: Conectar = async ({ systemInstruction, onMessage, onError, onClose }) => {
    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [modalidade],
        systemInstruction,
        tools: OLI_TOOLS,
        ...(modalidade === Modality.AUDIO ? { outputAudioTranscription: {} } : {}),
      },
      callbacks: { onmessage: onMessage, onerror: onError, onclose: onClose },
    });
    return {
      enviarTexto: (texto) => session.sendRealtimeInput({ text: texto }),
      responderFerramentas: (functionResponses) => session.sendToolResponse({ functionResponses }),
      fechar: () => session.close(),
    };
  };

  console.log(`Oli eval: modelo ${model}, ${cenarios.length} cenários, ${tentativas}x cada (mínimo ${minimo}).`);
  const res = await rodarTodos(cenarios, conectar, { timeoutMs, tentativas, minimo, hoje: todaySP() });
  console.log(redigir(formatarTabela(res), [apiKey]));
  const falhas = res.filter((r) => !r.ok);
  console.log(falhas.length ? `\n${falhas.length} cenário(s) falharam.` : "\nTodos os cenários passaram.");
  return falhas.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Falha na simulação:", redigir(err instanceof Error ? err.message : "erro", [process.env.GEMINI_API_KEY]));
    process.exit(1);
  });
