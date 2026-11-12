import "server-only";
import { GoogleGenAI } from "@google/genai";
import mammoth from "mammoth";
import { geminiBaseUrl } from "@/lib/financas/documentos/extraction";
import { docsApiKey, DOCS_DEFAULT_MODEL } from "@/lib/financas/documentos/extract";
import { isDocxZip } from "./files";
import { runSummary, SUMMARY_TIMEOUT_MS, type LessonMeta, type SourceFile, type SummaryClient } from "./summary";

/**
 * Resumo da aula com o Gemini: mesma configuração da leitura de documentos de Finanças
 * (chave só no servidor, modelo GEMINI_DOCS_MODEL ou o padrão, GEMINI_API_BASE só fora de produção).
 * Nada do conteúdo dos arquivos nem da resposta vai para log.
 */
function geminiClient(apiKey: string): SummaryClient {
  const baseUrl = geminiBaseUrl(process.env);
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { ...(baseUrl ? { baseUrl } : {}), timeout: SUMMARY_TIMEOUT_MS, retryOptions: { attempts: 1 } },
  });
  const model = process.env.GEMINI_DOCS_MODEL?.trim() || DOCS_DEFAULT_MODEL;
  return {
    async generate({ systemInstruction, contents, signal }) {
      const res = await ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction, temperature: 0.2, responseMimeType: "text/plain", abortSignal: signal },
      });
      return res.text;
    },
    async upload(bytes, mime, name, signal) {
      const file = await ai.files.upload({
        file: new Blob([new Uint8Array(bytes)], { type: mime }),
        config: { mimeType: mime, displayName: name.slice(0, 100), abortSignal: signal },
      });
      // A Files API processa antes de liberar (state ACTIVE); espera um pouco, sem passar do tempo limite.
      let f = file;
      for (let i = 0; i < 20 && f.state === "PROCESSING" && !signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        f = await ai.files.get({ name: f.name! });
      }
      if (f.state !== "ACTIVE" || !f.uri || !f.name) throw new Error("arquivo não liberado");
      return { uri: f.uri, mimeType: f.mimeType ?? mime, name: f.name };
    },
    async remove(name) {
      await ai.files.delete({ name });
    },
  };
}

/** Texto de um docx (mammoth). Só depois de conferir a estrutura do zip; erro → null. */
export async function docxToText(bytes: Uint8Array): Promise<string | null> {
  if (!isDocxZip(bytes)) return null;
  try {
    const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return r.value;
  } catch {
    return null;
  }
}

export const summaryConfigured = () => Boolean(docsApiKey());

export async function summarizeLesson(lesson: LessonMeta, files: SourceFile[]) {
  const apiKey = docsApiKey();
  if (!apiKey) return { ok: false as const, motivo: "erro" as const };
  // mammoth é assíncrono: extrai antes e entrega ao planejador (puro) por arquivo.
  const texts = new Map<SourceFile, string | null>();
  for (const f of files) if (f.mime.includes("wordprocessingml")) texts.set(f, await docxToText(f.bytes));
  const r = await runSummary(geminiClient(apiKey), lesson, files, (f) => texts.get(f) ?? null);
  if (!r.ok) console.error("Carisma: resumo falhou:", r.motivo);
  return r;
}
