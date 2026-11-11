import "server-only";
import { GoogleGenAI, Modality } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { OLI_API_VERSION, OLI_DEFAULT_MODEL, OLI_DEFAULT_VOICE, oliAllowedFor } from "@/lib/oli/access";
import { buildSystemInstruction, MAX_PROMPT_HISTORY, MAX_PROMPT_MEMORIES, OLI_TOOLS } from "@/lib/oli/prompt";
import { getRecentOliMessages } from "@/lib/oli/history";
import { todaySP } from "@/lib/financas/today";

/**
 * Emite um token efêmero do Gemini Live para o navegador.
 * A GEMINI_API_KEY nunca sai do servidor; modelo, persona, ferramentas e voz ficam travados no token.
 */
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // Mesmo site apenas (o cookie de sessão já é SameSite=Lax; isto barra POST de outra origem).
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Origem não permitida." }, 403);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return json({ error: "Faça login para conversar com o Oli." }, 401);

  const { data: link } = await supabase
    .from("household_users")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!link || !oliAllowedFor(link.household_id)) {
    return json({ error: "O Oli ainda não está liberado para esta família." }, 403);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "Oli não configurado." }, 503);

  // Memórias da família pela sessão do usuário (RLS), mais recentes primeiro.
  const { data: memories } = await supabase
    .from("oli_memories")
    .select("id, category, content")
    .eq("household_id", link.household_id)
    .order("created_at", { ascending: false })
    .limit(MAX_PROMPT_MEMORIES);

  // Conversa recente só desta pessoa (RLS); falha na leitura não derruba o token.
  const history = await getRecentOliMessages(supabase, MAX_PROMPT_HISTORY);

  const model = process.env.GEMINI_LIVE_MODEL || OLI_DEFAULT_MODEL;
  const voice = process.env.GEMINI_LIVE_VOICE || OLI_DEFAULT_VOICE;

  try {
    const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: OLI_API_VERSION } });
    const now = Date.now();
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: {
          model,
          config: {
            sessionResumption: {},
            responseModalities: [Modality.AUDIO],
            systemInstruction: buildSystemInstruction(memories ?? [], todaySP(), history),
            tools: OLI_TOOLS,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
      },
    });
    if (!token.name) throw new Error("token sem nome");
    return json({ token: token.name, model, apiVersion: OLI_API_VERSION }, 200);
  } catch (err) {
    console.error("Oli: falha ao criar token:", err instanceof Error ? err.message : "erro");
    return json({ error: "Não foi possível falar com o Gemini agora." }, 502);
  }
}
