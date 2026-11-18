import "server-only";
import { docsApiKey, geminiGenerate } from "@/lib/financas/documentos/extract";
import { runStructured, type Generate, type StructuredResult } from "@/lib/financas/documentos/extraction";
import { parseOliReadings, type OliFileReadingList } from "./arquivo";
import { OLI_FILE_INSTRUCTION, OLI_FILE_SCHEMA } from "./arquivo-schema";

/**
 * Leitura de arquivo do "+" do Oli: mesmo cliente do Gemini da leitura de documentos de Finanças
 * (GEMINI_DOCS_API_KEY → GEMINI_API_KEY, só no servidor; GEMINI_DOCS_MODEL; tempo limite de 60 s e sem
 * novas tentativas). Devolve a lista de documentos do arquivo (até 20). `generate` é injetável nos testes.
 */
export async function extractOliFile(
  bytes: Uint8Array,
  mime: "application/pdf" | "image/jpeg",
  generate?: Generate,
): Promise<StructuredResult<OliFileReadingList>> {
  let gen = generate;
  if (!gen) {
    const apiKey = docsApiKey();
    if (!apiKey) return { ok: false, motivo: "erro" };
    gen = geminiGenerate(apiKey);
  }
  const r = await runStructured(gen, bytes, mime, { systemInstruction: OLI_FILE_INSTRUCTION, schema: OLI_FILE_SCHEMA, parse: parseOliReadings });
  // Só o motivo, nunca o conteúdo do arquivo nem a resposta da IA.
  if (!r.ok) console.error("Oli: leitura do arquivo falhou:", r.motivo);
  return r;
}
