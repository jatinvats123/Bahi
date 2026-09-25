import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (npm run e2e). Deterministic and free: mock integrations (SWYTCH_MODE=mock)
 * and recorded runs (AGENT_MODE=replay), so no model or provider is called. The app is built
 * and served on its own port, next to any dev server that may be running.
 * E2E_REUSE=1 reuses a server already listening on E2E_PORT (faster local loops).
 */

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: process.env.E2E_REUSE ? `npx next start -p ${PORT}` : `npm run build && npx next start -p ${PORT}`,
    url: `${BASE}/api/brief`,
    reuseExistingServer: Boolean(process.env.E2E_REUSE),
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { SWYTCH_MODE: "mock", AGENT_MODE: "replay", REPLAY_SPEED: "8", BUSINESS_NAME: "DukaanSetu" },
  },
});
