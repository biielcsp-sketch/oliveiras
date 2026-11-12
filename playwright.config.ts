import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
export const E2E_HOUSEHOLD_ID = "eeeeeeee-0000-4000-8000-000000000001";
// Família da Agenda separada da do Open Finance: as duas specs rodam em paralelo e recriam a família.
export const E2E_AGENDA_HOUSEHOLD_ID = "eeeeeeee-0000-4000-8000-000000000002";
// Família autorizada para a leitura de documentos com IA (própria, para não colidir com Open Finance/Oli em paralelo).
export const E2E_DOCS_HOUSEHOLD_ID = "eeeeeeee-0000-4000-8000-000000000003";
// Família autorizada para o Carisma (Google Drive + resumo por IA), separada da Agenda para rodar em paralelo.
export const E2E_IGREJA_HOUSEHOLD_ID = "eeeeeeee-0000-4000-8000-000000000004";
// Família autorizada para o Oli (própria): open-finance.spec e oli-arquivo.spec recriavam a MESMA família
// (E2E_HOUSEHOLD_ID) e, rodando em workers paralelos no CI, um apagava os dados do outro.
export const E2E_OLI_HOUSEHOLD_ID = "eeeeeeee-0000-4000-8000-000000000005";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: [
    {
      // API da Pluggy simulada (só nos testes)
      command: "node tests/e2e/pluggy-mock.mjs",
      port: 4010,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Google (OAuth + Calendar) simulado (só nos testes)
      command: "node tests/e2e/google-mock.mjs",
      port: 4020,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Gemini simulado para a leitura de boletos/comprovantes (só nos testes; nunca chama a API real)
      command: "node tests/e2e/gemini-mock.mjs",
      port: 4030,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Google Drive simulado (Carisma; só nos testes): confere os tokens no Google simulado
      command: "node tests/e2e/drive-mock.mjs",
      port: 4040,
      reuseExistingServer: !process.env.CI,
    },
    {
      // O app precisa ter sido gerado antes com `npm run build` apontando para o Supabase local.
      command: `npm run start -- -p ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PLUGGY_API_URL: "http://127.0.0.1:4010",
        PLUGGY_CLIENT_ID: "test-client",
        PLUGGY_CLIENT_SECRET: "test-secret",
        PLUGGY_HOUSEHOLD_ID: E2E_HOUSEHOLD_ID,
        // Oli: família autorizada fixa e sem chave do Gemini (o token responde 503; nunca chama o Gemini real).
        OLI_HOUSEHOLD_ID: E2E_OLI_HOUSEHOLD_ID,
        GEMINI_API_KEY: "",
        // Documentos: chave própria + Gemini simulado. O token do Oli lê só GEMINI_API_KEY, então segue em 503.
        GEMINI_DOCS_API_KEY: "test-key",
        GEMINI_API_BASE: "http://127.0.0.1:4030",
        DOCS_HOUSEHOLD_ID: E2E_DOCS_HOUSEHOLD_ID,
        // Agenda: Google simulado em localhost e família própria.
        GOOGLE_CLIENT_ID: "test-google-client",
        GOOGLE_CLIENT_SECRET: "test-google-secret",
        GOOGLE_OAUTH_BASE: "http://127.0.0.1:4020",
        GOOGLE_API_BASE: "http://127.0.0.1:4020/calendar/v3",
        AGENDA_HOUSEHOLD_ID: E2E_AGENDA_HOUSEHOLD_ID,
        // Carisma: Drive simulado em localhost (a CSP libera essa origem só com esta variável e fora da produção)
        // e família própria; o resumo usa o Gemini simulado acima.
        GOOGLE_DRIVE_API_BASE: "http://127.0.0.1:4040/drive/v3",
        GOOGLE_DRIVE_UPLOAD_BASE: "http://127.0.0.1:4040/upload/drive/v3",
        CARISMA_HOUSEHOLD_ID: E2E_IGREJA_HOUSEHOLD_ID,
      },
    },
  ],
});
