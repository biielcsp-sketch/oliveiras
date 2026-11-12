import "server-only";
import { GoogleGenAI } from "@google/genai";
import { geminiBaseUrl, runExtraction, EXTRACTION_TIMEOUT_MS, type Generate, type ExtractionResult } from "./extraction";

/**
 * Leitura de boleto/comprovante com o Gemini (GEMINI_API_KEY só no servidor).
 * Modelo padrão: gemini-3.5-flash-lite — estável, aceita PDF e imagem e tem saída estruturada
 * (conferido em ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite em 10/11/2026).
 * GEMINI_DOCS_MODEL troca o modelo sem deploy de código.
 * GEMINI_API_BASE (opcional, ignorada com VERCEL_ENV=production) aponta para o servidor simulado dos testes E2E; GEMINI_DOCS_API_KEY
 * (opcional) tem prioridade sobre GEMINI_API_KEY, para os testes não ligarem o Oli.
 */
export const DOCS_DEFAULT_MODEL = "gemini-3.5-flash-lite";

/** Gerador do Gemini (exportado para a leitura de arquivos do Oli reaproveitar o mesmo cliente e limites). */
export function geminiGenerate(apiKey: string): Generate {
  const baseUrl = geminiBaseUrl(process.env);
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      ...(baseUrl ? { baseUrl } : {}),
      timeout: EXTRACTION_TIMEOUT_MS,
      retryOptions: { attempts: 1 }, // sem novas tentativas: custo e tempo previsíveis
    },
  });
  const model = process.env.GEMINI_DOCS_MODEL?.trim() || DOCS_DEFAULT_MODEL;
  return async ({ systemInstruction, schema, mime, base64, signal }) => {
    const res = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: "Extraia os dados deste documento conforme o schema." }],
        },
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
        abortSignal: signal,
      },
    });
    return res.text;
  };
}

/** Chave da leitura de documentos (só no servidor). */
export const docsApiKey = () => process.env.GEMINI_DOCS_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";

/** Sem chave configurada, não chama nada: o documento fica para preenchimento à mão. */
export async function extractDocument(bytes: Uint8Array, mime: "application/pdf" | "image/jpeg"): Promise<ExtractionResult> {
  const apiKey = docsApiKey();
  if (!apiKey) return { ok: false, motivo: "erro" };
  const r = await runExtraction(geminiGenerate(apiKey), bytes, mime);
  // Só o motivo, nunca o conteúdo do documento nem a resposta da IA.
  if (!r.ok) console.error("Finanças: leitura do documento falhou:", r.motivo);
  return r;
}
