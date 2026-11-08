// Servidor que imita a API da Pluggy nos testes E2E (nunca usado em produção).
// Cenário 1: carga inicial. POST /__scenario/2 simula a atualização do dia seguinte.
import { createServer } from "node:http";

const PORT = Number(process.env.PLUGGY_MOCK_PORT ?? 4010);
const ITEM = "11111111-1111-4111-8111-111111111111";
const CHECKING = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";
const today = new Date().toISOString().slice(0, 10);
const at = `${today}T00:00:00.000Z`;
let scenario = 1;

const tx = (id, description, amount, type, extra = {}) => ({ id, date: at, description, amount, type, status: "POSTED", ...extra });

function transactions(accountId) {
  if (accountId === CHECKING) {
    return scenario === 1
      ? [
          tx("t1", "SALARIO EMPRESA", 5000, "CREDIT", { providerId: "P1" }),
          tx("t2", "MERCADO PENDENTE", -120, "DEBIT", { providerId: "P2", status: "PENDING" }),
          tx("t3", "PADARIA", -15.5, "DEBIT"),
        ]
      : [
          tx("t1", "SALARIO EMPRESA", 5000, "CREDIT", { providerId: "P1" }),
          tx("t2", "MERCADO", -125.4, "DEBIT", { providerId: "P2" }),
          tx("t4", "FARMACIA", -60, "DEBIT", { providerId: "P3" }),
        ];
  }
  if (accountId === CARD) {
    // No cartão a Pluggy manda a compra com valor positivo (DEBIT).
    return scenario === 1
      ? [tx("c1", "IFOOD *LOJA", 45.9, "DEBIT"), tx("c2", "UBER *TRIP", 20, "DEBIT")]
      : [tx("c1", "IFOOD *LOJA", 45.9, "DEBIT"), tx("c9", "UBER TRIP SP", 20, "DEBIT")];
  }
  return [];
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "POST" && url.pathname === "/auth") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    return body.clientId === "test-client" && body.clientSecret === "test-secret"
      ? send(res, 200, { apiKey: "mock-key" })
      : send(res, 403, { message: "invalid" });
  }
  if (req.method === "POST" && url.pathname.startsWith("/__scenario/")) {
    scenario = Number(url.pathname.split("/").pop());
    return send(res, 200, { scenario });
  }
  if (url.pathname === "/__today") return send(res, 200, { today });
  if (req.headers["x-api-key"] !== "mock-key") return send(res, 403, { message: "no key" });

  if (url.pathname === `/items/${ITEM}`) {
    return send(res, 200, { id: ITEM, status: "UPDATED", consentExpiresAt: "2027-11-01T00:00:00.000Z", connector: { name: "Banco Teste" } });
  }
  if (url.pathname.startsWith("/items/")) return send(res, 404, { message: "not found" });
  if (url.pathname === "/accounts" && url.searchParams.get("itemId") === ITEM) {
    return send(res, 200, {
      results: [
        { id: CHECKING, name: "Conta Corrente", marketingName: "Conta Teste", number: "0001/12345-6", type: "BANK", subtype: "CHECKING_ACCOUNT", balance: 4864.5 },
        { id: CARD, name: "Cartão", marketingName: "Cartão Teste", number: "1234", type: "CREDIT", subtype: "CREDIT_CARD", balance: 65.9 },
      ],
    });
  }
  if (url.pathname === "/v2/transactions") {
    // Página de 2 itens para exercitar o cursor `next`.
    const all = transactions(url.searchParams.get("accountId"));
    const start = Number(url.searchParams.get("after") ?? 0);
    const results = all.slice(start, start + 2);
    const next = start + 2 < all.length ? `?accountId=${url.searchParams.get("accountId")}&after=${start + 2}` : null;
    return send(res, 200, { results, next });
  }
  send(res, 404, { message: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`pluggy mock on ${PORT}`));
