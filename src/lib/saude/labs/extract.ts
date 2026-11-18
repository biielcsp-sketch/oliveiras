import "server-only";
import { docsApiKey, geminiGenerate } from "@/lib/financas/documentos/extract";
import { runStructured, type Generate, type StructuredResult } from "@/lib/financas/documentos/extraction";
import { todaySP } from "@/lib/financas/today";
import { LAB_EXTRACT_INSTRUCTION, LAB_EXTRACT_SCHEMA } from "./extract-schema";
import { parseLabExtraction, type LabExtraction } from "./extraction";

/**
 * Leitura do laudo com o mesmo cliente do Gemini de Finanças/Oli (chave só no servidor, tempo limite de 60 s,
 * sem novas tentativas). `generate` é injetável nos testes. Só devolve a leitura validada: NÃO grava nada.
 */
export async function extractLabReport(
  bytes: Uint8Array,
  mime: "application/pdf" | "image/jpeg",
  generate?: Generate,
  today: string = todaySP(),
): Promise<StructuredResult<LabExtraction>> {
  let gen = generate;
  if (!gen) {
    const apiKey = docsApiKey();
    if (!apiKey) return { ok: false, motivo: "erro" };
    gen = geminiGenerate(apiKey);
  }
  const r = await runStructured(gen, bytes, mime, {
    systemInstruction: LAB_EXTRACT_INSTRUCTION,
    schema: LAB_EXTRACT_SCHEMA,
    parse: (t) => parseLabExtraction(t, today),
  });
  // Só o motivo, nunca o conteúdo do laudo nem a resposta da IA.
  if (!r.ok) console.error("Exames de laboratório: leitura falhou:", r.motivo);
  return r;
}
