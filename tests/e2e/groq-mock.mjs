// Groq simulado (só nos testes E2E): responde ao chat/completions do `analisar` do Oli. Nunca chama a API real.
// Exige o que o app precisa mandar: chave de teste no Authorization, modelo padrão, instrução de sistema do analista
// e os dados do app dentro de <dados_do_app>. A resposta cita o total e a comparação recebidos (prova que o contexto
// chegou) e traz uma tag HTML (o app precisa removê-la). Pergunta com "MOCK429" → 429 (o app cai no Gemini simulado).
import { createServer } from "node:http";

const PORT = Number(process.env.GROQ_MOCK_PORT ?? 4050);

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/openai/v1/chat/completions") return send(res, 404, { error: { message: "not found" } });
  if (req.headers.authorization !== "Bearer test-groq-key") return send(res, 401, { error: { message: "chave inválida" } });
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { error: { message: "json inválido" } });
    }
    const system = body?.messages?.find((m) => m.role === "system")?.content ?? "";
    const user = body?.messages?.find((m) => m.role === "user")?.content ?? "";
    if (body?.model !== "openai/gpt-oss-120b" || !system.includes("analista da família") || !user.includes("<dados_do_app>")) {
      return send(res, 400, { error: { message: "pedido incompleto" } });
    }
    if (user.includes("MOCK429")) return send(res, 429, { error: { message: "rate limit" } });
    const total = /Saídas: (-?[\d.]+)/.exec(user)?.[1] ?? "?";
    const anterior = /^- [^(\n]+\(\d{4}-\d{2}\): (-?[\d.]+)/m.exec(user)?.[1] ?? "?";
    const content = `Análise simulada pelo Groq. <b>Saídas do período: ${total}</b>. Mês anterior: ${anterior}.`;
    send(res, 200, { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`groq-mock em ${PORT}`));
