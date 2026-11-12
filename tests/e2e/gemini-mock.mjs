// Gemini simulado (só nos testes E2E): responde ao generateContent da leitura de documentos.
// O PDF de teste traz a resposta desejada numa linha "MOCKRESP:<base64 do JSON>"; "MOCKFAIL" devolve erro 500.
// Resumo do Carisma (instrução com "seminário teológico", texto simples): exige os dados da aula e devolve um resumo
// simulado que cita quantos arquivos vieram inline e traz uma tag HTML (o app precisa removê-la). "MOCKFAIL" → 500.
// Nunca chama a API real.
import { createServer } from "node:http";

const PORT = Number(process.env.GEMINI_MOCK_PORT ?? 4030);

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method !== "POST" || !/^\/v1(?:beta)?\/models\/[^/:]+:generateContent/.test(req.url ?? "")) return send(res, 404, { error: { code: 404, path: req.url } });
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { error: { code: 400 } });
    }
    const parts = body?.contents?.[0]?.parts ?? [];
    if (JSON.stringify(body?.systemInstruction ?? "").includes("seminário teológico")) {
      const texts = parts.filter((p) => typeof p.text === "string").map((p) => p.text);
      const inline = parts.filter((p) => p.inlineData?.data);
      if (!texts.some((t) => t.includes("<dados_da_aula>"))) return send(res, 400, { error: { code: 400, message: "sem dados da aula" } });
      const all = texts.join("\n") + inline.map((p) => Buffer.from(p.inlineData.data, "base64").toString("latin1")).join("\n");
      if (all.includes("MOCKFAIL")) return send(res, 500, { error: { code: 500, message: "falha simulada" } });
      const text = `Tópicos principais\n- <b>Resumo simulado</b> da aula\nArquivos inline: ${inline.length}\nVersículos citados\n- João 3:16`;
      return send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
    }
    // Exige o que o app precisa mandar: instrução de sistema, JSON estruturado e o arquivo inline.
    const file = parts.find((p) => p.inlineData)?.inlineData;
    const cfg = body?.generationConfig ?? {};
    if (!body?.systemInstruction || cfg.responseMimeType !== "application/json" || !cfg.responseSchema || !file?.data) {
      return send(res, 400, { error: { code: 400, message: "pedido incompleto" } });
    }
    const content = Buffer.from(file.data, "base64").toString("latin1");
    if (content.includes("MOCKFAIL")) return send(res, 500, { error: { code: 500, message: "falha simulada" } });
    const m = content.match(/MOCKRESP:([A-Za-z0-9+/=]+)/);
    const text = m ? Buffer.from(m[1], "base64").toString("utf8") : JSON.stringify({ tipo: "outro" });
    send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`gemini-mock em ${PORT}`));
