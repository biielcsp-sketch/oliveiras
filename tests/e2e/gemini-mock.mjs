// Gemini simulado (só nos testes E2E): responde ao generateContent da leitura de documentos.
// O PDF de teste traz a resposta desejada numa linha "MOCKRESP:<base64 do JSON>"; "MOCKFAIL" devolve erro 500.
// Leitura com lista (schema com `documentos`): um objeto solto vira lista de um item (ver abaixo).
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
    // "Estudar com o Oli" (Carisma): devolve o modo pedido, se as anotações vieram e quais arquivos de texto/docx e quantos inline.
    if (JSON.stringify(body?.systemInstruction ?? "").includes("Você é o Oli, assistente do aluno")) {
      const texts = parts.filter((p) => typeof p.text === "string").map((p) => p.text);
      if (!texts.some((t) => t.includes("<dados_da_aula>"))) return send(res, 400, { error: { code: 400, message: "sem dados da aula" } });
      const last = texts[texts.length - 1] ?? "";
      const mode = /MODO: (\w+)/.exec(last)?.[1] ?? "?";
      const q = /<pergunta_do_aluno>\n([\s\S]*?)\n<\/pergunta_do_aluno>/.exec(last)?.[1] ?? "";
      const notes = /<anotacoes_do_aluno>\n([\s\S]*?)\n<\/anotacoes_do_aluno>/.exec(texts.join("\n"))?.[1] ?? "";
      const named = [...texts.join("\n").matchAll(/<arquivo nome="([^"]+)">\n([\s\S]*?)\n<\/arquivo>/g)].map((m) => `${m[1]}=${m[2].slice(0, 40)}`);
      const inline = parts.filter((p) => p.inlineData?.data).length;
      const text = `Modo ${mode}\nPergunta: ${q}\nAnotações: ${notes.slice(0, 60)}\nArquivos de texto: ${named.join("; ")}\nInline: ${inline}`;
      return send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
    }
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
    let text = m ? Buffer.from(m[1], "base64").toString("utf8") : JSON.stringify({ tipo: "outro" });
    // Leitura de boletos/comprovantes (Finanças e "+" do Oli): o schema pede { documentos: [...] }. PDF de teste com
    // um objeto só (formato antigo, um documento) vira lista de um item; quem quer vários manda `documentos`.
    if (cfg.responseSchema?.properties?.documentos) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !("documentos" in parsed)) text = JSON.stringify({ documentos: [parsed] });
      } catch {
        // resposta inválida de propósito: segue como veio
      }
    }
    send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`gemini-mock em ${PORT}`));
