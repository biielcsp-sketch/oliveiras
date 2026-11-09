import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
export const E2E_HOUSEHOLD_ID = "eeeeeeee-0000-4000-8000-000000000001";
// Família da Agenda separada da do Open Finance: as duas specs rodam em paralelo e recriam a família.
export const E2E_AGENDA_HOUSEHOLD_ID = "eeeeeeee-0000-4000-8000-000000000002";

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
        OLI_HOUSEHOLD_ID: E2E_HOUSEHOLD_ID,
        GEMINI_API_KEY: "",
        // Agenda: Google simulado em localhost e família própria.
        GOOGLE_CLIENT_ID: "test-google-client",
        GOOGLE_CLIENT_SECRET: "test-google-secret",
        GOOGLE_OAUTH_BASE: "http://127.0.0.1:4020",
        GOOGLE_API_BASE: "http://127.0.0.1:4020/calendar/v3",
        AGENDA_HOUSEHOLD_ID: E2E_AGENDA_HOUSEHOLD_ID,
      },
    },
  ],
});
